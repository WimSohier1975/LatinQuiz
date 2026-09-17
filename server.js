const express = require('express');
const session = require('express-session');
const bcrypt = require('bcrypt');
const XLSX = require('xlsx');
const fs = require('fs');

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const niveauOrde = [
    'B1','B2','B3','B4','B5','B6',
    'MB1','MB2','MB3','MB4','MB5','MB6',
    'MA1','MA2','MA3','MA4','MA5','MA6',
    'ML1','ML2','ML3','ML4','ML5','ML6',
    'H1','H2','H3','H4',
    'U1','U2','U3','U4','U5','U6','U7'
];

function heeftToegang(gebruikerNiveau, vereistNiveau) {
 const indexGebruiker = niveauOrde.indexOf(gebruikerNiveau); 
 const indexVereist = niveauOrde.indexOf(vereistNiveau);    
 
 // Als een quiz geen niveau heeft (leeg), mag iedereen hem doen
 if (indexVereist === -1) return true;
 
 // Gebruiker moet op dezelfde index of hoger zitten
 return indexGebruiker >= indexVereist;
}


app.use(session({
    secret: 'quiz-super-geheim-sleutel',
    resave: false,
    saveUninitialized: false, // Belangrijk: op false zetten
    cookie: { 
        secure: false, // Moet op false staan voor lokale ontwikkeling (http)
        httpOnly: true,
        maxAge: 24 * 60 * 60 * 1000 // 24 uur geldig
    }
}));

app.use(express.static('public'));

const WOORDEN_FILE = 'woorden.xlsx';
const CONFIG_FILE = 'config.xlsx';
const PORT = process.env.PORT || 3000;

// Middleware om te checken of iemand Admin is
const checkAdmin = (req, res, next) => {
    if (req.session.ingelogd && req.session.rol === 'Admin') {
        next();
    } else {
        res.status(403).send("Toegang geweigerd: Alleen voor Admins");
    }
};

app.get('/api/admin/gebruikers', checkAdmin, (req, res) => {
    try {
        const workbook = XLSX.readFile(CONFIG_FILE);
        const data = XLSX.utils.sheet_to_json(workbook.Sheets['gebruikers']);
        // Stuur wachtwoorden nooit mee
        const veiligData = data.map(u => ({
            gebruikersnaam: u.gebruikersnaam,
            rol: u.rol
        }));
        res.json(veiligData);
    } catch (e) {
        res.status(500).json([]);
    }
});

// Middleware om toegang te blokkeren voor niet-ingelogde mensen
const checkLogin = (req, res, next) => {
    if (req.session && req.session.ingelogd) {
        next();
    } else {
        res.status(403).json({ error: "Niet ingelogd" });
    }
};

app.get('/api/me', (req, res) => {
    if (req.session && req.session.ingelogd) {
        res.json({ 
            ingelogd: true, 
            rol: req.session.rol,
            niveau: req.session.niveau 
        });
    } else {
        res.status(401).json({ ingelogd: false });
    }
});

app.post('/api/login', async (req, res) => {
    try {
        const { gebruikersnaam, wachtwoord } = req.body;
        //console.log("Login poging voor:", gebruikersnaam);

        const workbook = XLSX.readFile(CONFIG_FILE);
        const gebruikers = XLSX.utils.sheet_to_json(workbook.Sheets['gebruikers']);

        // ZOEK ALLEEN OP NAAM (niet op wachtwoord, want dat is een hash!)
        const gebruiker = gebruikers.find(u => String(u.gebruikersnaam).trim() === String(gebruikersnaam).trim());

        if (gebruiker) {
            //console.log("Gebruiker gevonden, wachtwoord vergelijken...");
            
            // Vergelijk het ingevoerde wachtwoord met de hash uit Excel
            const match = await bcrypt.compare(String(wachtwoord), String(gebruiker.wachtwoord));
            
            if (match) {
                req.session.ingelogd = true;
                req.session.gebruiker = gebruiker.gebruikersnaam;
                req.session.rol = gebruiker.rol;
                req.session.niveau = String(gebruiker.niveau).trim(); 
                //console.log("Match! Ingelogd als:", gebruiker.rol);
                return res.json({ success: true, rol: gebruiker.rol });
            } else {
                console.log("Wachtwoord matcht niet met de hash.");
            }
        } else {
            console.log("Gebruikersnaam niet gevonden in Excel.");
        }
        
        res.status(401).json({ success: false, bericht: "Onjuiste gegevens" });
    } catch (e) {
        console.error("Login Error:", e);
        res.status(500).send("Server fout");
    }
});

app.post('/api/logout', (req, res) => {
    req.session.destroy((err) => {
        if (err) {
            return res.status(500).send("Kon niet uitloggen");
        }
        res.clearCookie('connect.sid'); // Verwijder de sessie-cookie in de browser
        res.json({ success: true });
    });
});

// API om gebruiker toe te voegen (met hashing!)
app.post('/api/admin/gebruikers', checkAdmin, async (req, res) => {
    const { nieuweNaam, nieuwWachtwoord, nieuweRol, nieuwNiveau } = req.body;
    const hash = await bcrypt.hash(String(nieuwWachtwoord), 10);
    
    const workbook = XLSX.readFile(CONFIG_FILE);
    let data = XLSX.utils.sheet_to_json(workbook.Sheets['gebruikers']);
    
    // Voeg het niveau toe aan het object
    data.push({ 
        gebruikersnaam: nieuweNaam, 
        wachtwoord: hash, 
        rol: nieuweRol, 
        niveau: nieuwNiveau // Nieuw veld!
    });
    
    const newSheet = XLSX.utils.json_to_sheet(data);
    workbook.Sheets['gebruikers'] = newSheet;
    XLSX.writeFile(workbook, CONFIG_FILE);
    res.json({ success: true });
});

app.delete('/api/admin/gebruikers/:naam', checkAdmin, (req, res) => {
    try {
        const naam = decodeURIComponent(req.params.naam).trim();
        const workbook = XLSX.readFile(CONFIG_FILE);
        let data = XLSX.utils.sheet_to_json(workbook.Sheets['gebruikers']);
        
        // Filter de te verwijderen gebruiker eruit
        const nieuweData = data.filter(u => String(u.gebruikersnaam).trim() !== naam);
        
        const newSheet = XLSX.utils.json_to_sheet(nieuweData);
        workbook.Sheets['gebruikers'] = newSheet;
        XLSX.writeFile(workbook, CONFIG_FILE);
        res.json({ success: true });
    } catch (e) {
        res.status(500).send("Fout bij verwijderen gebruiker.");
    }
});

// Haal ALLEEN de persoonlijke favorietenlijsten op
app.get('/api/favorieten', checkLogin, (req, res) => {
 try {
 const workbook = XLSX.readFile(CONFIG_FILE);
 const data = XLSX.utils.sheet_to_json(workbook.Sheets['quizzen']);
 const huidigeGebruiker = req.session.gebruiker; // Haal de ingelogde gebruiker op
 
 // Filter op type 'F' EN controleer of de lijst van de huidige gebruiker is
 const favorieten = data
 .filter(q => String(q.type).trim().toUpperCase() === 'F' && q.gebruiker === huidigeGebruiker)
 .map(q => q.quiznaam);
 
 res.json(favorieten);
 } catch (e) {
 console.error("Fout bij ophalen favorieten:", e);
 res.json([]);
 }
});


// Sla een nieuwe favorietenlijst op, gekoppeld aan de gebruiker
app.post('/api/favorieten', checkLogin, (req, res) => {
 try {
 const { quiznaam } = req.body;
 const huidigeGebruiker = req.session.gebruiker; // Wie maakt de lijst aan?
 
 const workbook = fs.existsSync(CONFIG_FILE) ? XLSX.readFile(CONFIG_FILE) : XLSX.utils.book_new();
 let data = workbook.Sheets['quizzen'] ? XLSX.utils.sheet_to_json(workbook.Sheets['quizzen']) : [];
 
 // Voeg de kolom 'gebruiker' toe aan het record
 data.push({ quiznaam, type: "F", taal: "", boek: "", gebruiker: huidigeGebruiker });
 
 const newSheet = XLSX.utils.json_to_sheet(data);
 workbook.Sheets['quizzen'] = newSheet;
 XLSX.writeFile(workbook, CONFIG_FILE);
 res.json({ success: true });
 } catch (e) { res.status(500).send("Bestand vergrendeld."); }
});


// Check of woorden in de geselecteerde favoriet staan van DEZE gebruiker
app.post('/api/favorieten/check', checkLogin, (req, res) => {
    try {
    const { favoriet, woorden } = req.body; 
    const huidigeGebruiker = req.session.gebruiker; // Haal ingelogde gebruiker op
    
    const workbook = XLSX.readFile(CONFIG_FILE);
    const sheet = workbook.Sheets['favorieten'];
    const data = sheet ? XLSX.utils.sheet_to_json(sheet) : [];
    
    const status = woorden.map(w => {
    return data.some(f => 
    f.favoriet === favoriet &&
    f.gebruiker === huidigeGebruiker && // Extra controle op gebruiker
    f.taal === w.taal &&
    f.boek === w.boek &&
    f.hoofdstuk === (w.hoofdstuk || "") &&
    f.volgnr == w.volgnr
    );
    });
    res.json(status);
    } catch (e) { res.json([]); }
});


// Toggle woord in persoonlijke favorieten (Toevoegen of Verwijderen)
app.post('/api/favorieten/toggle', checkLogin, (req, res) => {
    try {
    const { favoriet, woord } = req.body;
    const huidigeGebruiker = req.session.gebruiker; // Haal ingelogde gebruiker op
    
    const workbook = fs.existsSync(CONFIG_FILE) ? XLSX.readFile(CONFIG_FILE) : XLSX.utils.book_new();
    const sheetName = 'favorieten';
    let data = workbook.Sheets[sheetName] ? XLSX.utils.sheet_to_json(workbook.Sheets[sheetName]) : [];
    
    // Zoek of DIT specifieke woord al door DEZE gebruiker in DEZE lijst is gezet
    const index = data.findIndex(f => 
    f.favoriet === favoriet &&
    f.gebruiker === huidigeGebruiker && // Extra controle op gebruiker
    f.taal === woord.taal &&
    f.boek === woord.boek &&
    f.hoofdstuk === (woord.hoofdstuk || "") &&
    f.volgnr == woord.volgnr
    );
    
    if (index > -1) {
    data.splice(index, 1); // Verwijder als het er al in staat van deze gebruiker
    } else {
    // Voeg toe én sla de gebruikersnaam mee op in de Excel-rij
    data.push({ favoriet, gebruiker: huidigeGebruiker, ...woord }); 
    }
    
    const newSheet = XLSX.utils.json_to_sheet(data);
    workbook.Sheets[sheetName] = newSheet;
    if (!workbook.SheetNames.includes(sheetName)) XLSX.utils.book_append_sheet(workbook, newSheet, sheetName);
    XLSX.writeFile(workbook, CONFIG_FILE);
    
    res.json({ success: true, actie: index > -1 ? 'verwijderd' : 'toegevoegd' });
    } catch (e) { res.status(500).send("Fout bij bijwerken favorieten."); }
});

// 1. Haal de quiznamen op uit config.xlsx
app.get('/api/quizzen', checkLogin, (req, res) => {
    try {
    const workbook = XLSX.readFile(CONFIG_FILE);
    const data = XLSX.utils.sheet_to_json(workbook.Sheets['quizzen']);
    const huidigeGebruiker = req.session.gebruiker; // Haal ingelogde gebruiker op
    
    // Admins zien alles, anderen alleen hun eigen favorieten en geldige quizzen
    const gefilterdeQuizzen = data.filter(q => {
    // --- EXTRA CHECK VOOR PRIVÉ FAVORIETEN ---
    // Als het een favorietenlijst is ('F'), mag je hem alleen zien als hij van JOU is
    if (String(q.type).trim().toUpperCase() === 'F') {
    return q.gebruiker === huidigeGebruiker;
    }

    // --- NORMALE QUIZ LOGICA (Type 'T' of regulier) ---
    if (req.session.rol === 'Admin') return true;
    
    const qNiveau = String(q.niveau || "").trim();
    const gNiveau = String(req.session.niveau || "").trim();
    const indexG = niveauOrde.indexOf(gNiveau);
    const indexQ = niveauOrde.indexOf(qNiveau);
    
    if (indexQ === -1) return true; // Geen niveau = altijd tonen
    return indexG >= indexQ;
    });
    
    res.json(gefilterdeQuizzen.map(q => q.quiznaam)); 
    } catch (e) {
    console.error("Fout bij ophalen quizzen:", e);
    res.status(404).json([]);
    }
});

app.post('/api/quizzen', checkLogin, (req, res) => {
    try {
        const nieuweQuiz = req.body;
        const workbook = fs.existsSync(CONFIG_FILE) ? XLSX.readFile(CONFIG_FILE) : XLSX.utils.book_new();
        const sheetName = 'quizzen';
        let data = workbook.Sheets[sheetName] ? XLSX.utils.sheet_to_json(workbook.Sheets[sheetName]) : [];

        data.push({
            quiznaam: nieuweQuiz.quiznaam,
            niveau: nieuweQuiz.niveau || "",
            taal: nieuweQuiz.taal,
            boek: nieuweQuiz.boek,
            hoofdstuk: nieuweQuiz.hoofdstuk || "",
            volgnrVanaf: nieuweQuiz.volgnrVanaf || "",
            volgnrTot: nieuweQuiz.volgnrTot || "",
            middenkolom: nieuweQuiz.middenkolom || "Ja",
            type: "T" // 'T' voor tijdelijk
        });

        const newSheet = XLSX.utils.json_to_sheet(data);
        workbook.Sheets[sheetName] = newSheet;
        if (!workbook.SheetNames.includes(sheetName)) XLSX.utils.book_append_sheet(workbook, newSheet, sheetName);
        XLSX.writeFile(workbook, CONFIG_FILE);
        res.json({ success: true });
    } catch (e) { res.status(500).send("Excel bestand is vergrendeld."); }
});

//Haal alleen tijdelijke quizzen op
app.get('/api/quizzen/tijdelijk', checkLogin, (req, res) => {
    try {
        const workbook = XLSX.readFile(CONFIG_FILE);
        const data = XLSX.utils.sheet_to_json(workbook.Sheets['quizzen']);
        const tijdelijk = data.filter(q => q.type === 'T').map(q => q.quiznaam);
        res.json(tijdelijk);
    } catch (e) { res.json([]); }
});

app.delete('/api/quizzen/:naam', checkLogin, (req, res) => {
 try {
 const naam = decodeURIComponent(req.params.naam).trim();
 const huidigeGebruiker = req.session.gebruiker;
 const workbook = XLSX.readFile(CONFIG_FILE);
 
 // 1. Verwijder uit tabblad 'quizzen' (Check op naam én gebruiker, behalve als het een Admin is die een tijdelijke quiz wist)
 if (workbook.Sheets['quizzen']) {
 let quizData = XLSX.utils.sheet_to_json(workbook.Sheets['quizzen']);
 const nieuweQuizData = quizData.filter(q => {
 if (String(q.quiznaam).trim() === naam) {
 // Als het een favoriet is, mag je hem alleen wissen als hij van jou is
 if (q.type === 'F') return q.gebruiker !== huidigeGebruiker;
 }
 return true;
 });
 workbook.Sheets['quizzen'] = XLSX.utils.json_to_sheet(nieuweQuizData);
 }
 
 // 2. Verwijder bijbehorende woorden uit 'favorieten'
 if (workbook.Sheets['favorieten']) {
 let favWoordenData = XLSX.utils.sheet_to_json(workbook.Sheets['favorieten']);
 const nieuweFavWoordenData = favWoordenData.filter(f => {
 return !(String(f.favoriet).trim() === naam && f.gebruiker === huidigeGebruiker);
 });
 workbook.Sheets['favorieten'] = XLSX.utils.json_to_sheet(nieuweFavWoordenData);
 }
 
 XLSX.writeFile(workbook, CONFIG_FILE);
 res.json({ success: true });
 } catch (e) { 
 console.error("Fout bij volledig verwijderen:", e);
 res.status(500).send("Verwijderen mislukt."); 
 }
});


// 2. Genereer quiz met filters voor taal, boek, hoofdstuk en volgnummers
app.get('/api/vragen/:quiznaam', checkLogin, (req, res) => {
    try {
        const configWb = XLSX.readFile(CONFIG_FILE);
        const configData = XLSX.utils.sheet_to_json(configWb.Sheets['quizzen']);
        
        const gezochteQuiz = decodeURIComponent(req.params.quiznaam).trim();
        const quizConf = configData.find(q => String(q.quiznaam).trim() === gezochteQuiz);
        
        if (!quizConf) return res.status(404).send("Quiz niet gevonden");

        // --- NIEUW: NIVEAU CONTROLE OP QUIZ-NIVEAU ---
        //const niveauOrde = [ staat boven server.js gedefinieerd ] 
        const gebruikerNiveauIndex = niveauOrde.indexOf(req.session.niveau);
        const quizNiveauIndex = niveauOrde.indexOf(quizConf.niveau);

        // Check of de gebruiker het vereiste niveau heeft (Admins mogen alles)
        if (req.session.rol !== 'Admin' && quizNiveauIndex !== -1 && gebruikerNiveauIndex < quizNiveauIndex) {
            return res.status(403).send(`Je niveau (${req.session.niveau}) is te laag voor deze quiz (${quizConf.niveau}).`);
        }

        const woordenWb = XLSX.readFile(WOORDEN_FILE);
        const alleWoorden = XLSX.utils.sheet_to_json(woordenWb.Sheets[woordenWb.SheetNames[0]]);

        let gefilterdeWoorden = [];

        // --- GUEST BEPERKING ---
        if (req.session.rol === 'Guest') {
            const eersteQuizNaam = configData.length > 0 ? String(configData[0].quiznaam).trim() : null;
            if (gezochteQuiz !== eersteQuizNaam) {
                return res.status(403).send("Als gast mag je alleen de eerste quiz uitproberen.");
            }
        }        

        // 1. CHECK OF HET EEN FAVORIETEN-QUIZ IS
        if (String(quizConf.type).toUpperCase() === 'F') {
            const favSheet = configWb.Sheets['favorieten'];
            const alleFavorietenData = favSheet ? XLSX.utils.sheet_to_json(favSheet) : [];
            const lijstSpecifiekeWoorden = alleFavorietenData.filter(f => String(f.favoriet).trim() === gezochteQuiz);

            gefilterdeWoorden = alleWoorden.filter(w => {
                return lijstSpecifiekeWoorden.some(f => 
                    String(f.taal).trim().toLowerCase() === String(w.taal).trim().toLowerCase() &&
                    String(f.boek).trim().toLowerCase() === String(w.boek).trim().toLowerCase() &&
                    String(f.volgnr) == String(w.volgnr)
                );
            });
        } else {
            // 2. NORMALE QUIZ LOGICA
            const match = (val1, val2) => {
                if (!val2) return true;
                return String(val1).trim().toLowerCase() === String(val2).trim().toLowerCase();
            };

            gefilterdeWoorden = alleWoorden.filter(w => {
                if (!match(w.taal, quizConf.taal) || !match(w.boek, quizConf.boek)) return false;

                if (quizConf.hoofdstuk && String(quizConf.hoofdstuk).trim() !== "") {
                    return match(w.hoofdstuk, quizConf.hoofdstuk);
                } 
                
                const nVanaf = quizConf.volgnrVanaf ? Number(quizConf.volgnrVanaf) : -Infinity;
                const nTot = quizConf.volgnrTot ? Number(quizConf.volgnrTot) : Infinity;
                const wNum = Number(w.volgnr);

                return wNum >= nVanaf && wNum <= nTot;
            });
        }

        // --- NIEUW: FILTER INDIVIDUELE WOORDEN OP NIVEAU ---
        if (req.session.rol !== 'Admin') {
            gefilterdeWoorden = gefilterdeWoorden.filter(w => {
                const woordNiveauIndex = niveauOrde.indexOf(w.niveau);
                // Als het woord geen niveau heeft (index -1), mag het altijd getoond worden
                return woordNiveauIndex === -1 || woordNiveauIndex <= gebruikerNiveauIndex; 
            });
        }

        if (gefilterdeWoorden.length === 0) {
            return res.status(404).send("Geen woorden gevonden voor jouw niveau.");
        }

        // 3. QUIZ MIX-LOGICA
        const alleGrondwoorden = gefilterdeWoorden.map(w => String(w.grondwoord || ""));
        const alleVertalingen = gefilterdeWoorden.map(w => String(w.vertaling || ""));

        const quizMix = gefilterdeWoorden.map(r => {
            const vText = String(r.grondwoord || "");
            const cText = String(r.vertaling || "");
            const omdraaien = Math.random() > 0.5;

            let displayVraag, goedAntwoord, pool;
            if (omdraaien) {
                displayVraag = cText; goedAntwoord = vText; pool = alleGrondwoorden;
            } else {
                displayVraag = vText; goedAntwoord = cText; pool = alleVertalingen;
            }

            const fouteOpties = [...new Set(pool.filter(a => a !== goedAntwoord && a !== ""))]
                .sort(() => 0.5 - Math.random()).slice(0, 3);
            const opties = [goedAntwoord, ...fouteOpties].sort(() => 0.5 - Math.random());

            return {
                vraag: displayVraag,
                antwoorden: opties,
                correct: opties.indexOf(goedAntwoord),
                middenkolom: String(r.middenkolom || ""),
                tip: `(${r.volgnr || '-'}) ${r.afleiding || ""}`,
                taal: r.taal,
                boek: r.boek,
                hoofdstuk: r.hoofdstuk,
                volgnr: r.volgnr
            };
        });

        const gerandomiseerdeVragen = quizMix.sort(() => Math.random() - 0.5);

        res.json({
            type: quizConf.type,
            middenkolomCheck: quizConf.middenkolom !== "Nee",
            vragen: gerandomiseerdeVragen
        });

    } catch (e) {
        console.error("KRITIEKE FOUT:", e);
        res.status(500).send("Fout bij verwerken Excel data");
    }
});

// 3. Beschikbare opties uit woordenlijst om nieuwe quiz te kunnen maken
app.get('/api/opties', checkLogin, (req, res) => {
    try {
        const workbook = XLSX.readFile(WOORDEN_FILE);
        const data = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames]);
        // Stuur alle woorden door zodat de frontend kan filteren
        res.json(data);
    } catch (e) {
        res.status(500).send("Fout bij ophalen opties");
    }
});

app.listen(PORT, '0.0.0.0', () => console.log(`Server actief op poort ${PORT}`));
