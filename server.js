const express = require('express');
const session = require('express-session');
const bcrypt = require('bcrypt');
const XLSX = require('xlsx');
const fs = require('fs');

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

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
        res.json({ ingelogd: true, rol: req.session.rol });
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
    const { nieuweNaam, nieuwWachtwoord, nieuweRol } = req.body;
    const hash = await bcrypt.hash(String(nieuwWachtwoord), 10);
    
    const workbook = XLSX.readFile(CONFIG_FILE);
    let data = XLSX.utils.sheet_to_json(workbook.Sheets['gebruikers']);
    
    data.push({ gebruikersnaam: nieuweNaam, wachtwoord: hash, rol: nieuweRol });
    
    workbook.Sheets['gebruikers'] = XLSX.utils.sheet_to_json(data); // foutje in XLSX utils fix:
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

// Haal alleen favoriete quizzen op
app.get('/api/favorieten', checkLogin, (req, res) => {
    try {
        const workbook = XLSX.readFile(CONFIG_FILE);
        const data = XLSX.utils.sheet_to_json(workbook.Sheets['quizzen']);
        
        // Filter op type 'F' en verwijder spaties voor de zekerheid
        const favorieten = data
            .filter(q => String(q.type).trim().toUpperCase() === 'F')
            .map(q => q.quiznaam);
            
        //console.log("Gevonden favorieten:", favorieten); // Check je terminal!
        res.json(favorieten);
    } catch (e) {
        console.error("Fout bij ophalen favorieten:", e);
        res.json([]);
    }
});

// Voeg een nieuwe favoriet-naam toe
app.post('/api/favorieten', checkLogin, (req, res) => {
    try {
        const { quiznaam } = req.body;
        const workbook = fs.existsSync(CONFIG_FILE) ? XLSX.readFile(CONFIG_FILE) : XLSX.utils.book_new();
        let data = workbook.Sheets['quizzen'] ? XLSX.utils.sheet_to_json(workbook.Sheets['quizzen']) : [];

        data.push({ quiznaam, type: "F", taal: "", boek: "" }); // Basis record

        const newSheet = XLSX.utils.json_to_sheet(data);
        workbook.Sheets['quizzen'] = newSheet;
        XLSX.writeFile(workbook, CONFIG_FILE);
        res.json({ success: true });
    } catch (e) { res.status(500).send("Bestand vergrendeld."); }
});

// Check of woorden in de geselecteerde favoriet staan
app.post('/api/favorieten/check', checkLogin, (req, res) => {
    try {
        const { favoriet, woorden } = req.body; // woorden is een array van {taal, boek, hoofdstuk, volgnr}
        const workbook = XLSX.readFile(CONFIG_FILE);
        const sheet = workbook.Sheets['favorieten'];
        const data = sheet ? XLSX.utils.sheet_to_json(sheet) : [];

        const status = woorden.map(w => {
            return data.some(f => 
                f.favoriet === favoriet &&
                f.taal === w.taal &&
                f.boek === w.boek &&
                f.hoofdstuk === w.hoofdstuk &&
                f.volgnr == w.volgnr
            );
        });
        res.json(status);
    } catch (e) { res.json([]); }
});

// Toggle woord in favorieten (Toevoegen of Verwijderen)
app.post('/api/favorieten/toggle', checkLogin, (req, res) => {
    try {
        const { favoriet, woord } = req.body;
        const workbook = fs.existsSync(CONFIG_FILE) ? XLSX.readFile(CONFIG_FILE) : XLSX.utils.book_new();
        const sheetName = 'favorieten';
        let data = workbook.Sheets[sheetName] ? XLSX.utils.sheet_to_json(workbook.Sheets[sheetName]) : [];

        const index = data.findIndex(f => 
            f.favoriet === favoriet &&
            f.taal === woord.taal &&
            f.boek === woord.boek &&
            f.hoofdstuk === (woord.hoofdstuk || "") &&
            f.volgnr == woord.volgnr
        );

        if (index > -1) {
            data.splice(index, 1); // Verwijder als het er al in staat
        } else {
            data.push({ favoriet, ...woord }); // Voeg toe
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
        const sheet = workbook.Sheets['quizzen'];
        const data = XLSX.utils.sheet_to_json(sheet);
        res.json(data.map(q => q.quiznaam)); 
    } catch (e) {
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
            taal: nieuweQuiz.taal,
            boek: nieuweQuiz.boek,
            hoofdstuk: nieuweQuiz.hoofdstuk || "",
            volgnrVanaf: nieuweQuiz.volgnrVanaf || "",
            volgnrTot: nieuweQuiz.volgnrTot || "",
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

// Verwijder een quiz of favorietenlijst EN alle bijbehorende woorden
app.delete('/api/quizzen/:naam', checkLogin, (req, res) => {
    try {
        const naam = decodeURIComponent(req.params.naam).trim();
        const workbook = XLSX.readFile(CONFIG_FILE);
        
        // 1. Verwijder uit tabblad 'quizzen'
        if (workbook.Sheets['quizzen']) {
            let quizData = XLSX.utils.sheet_to_json(workbook.Sheets['quizzen']);
            const nieuweQuizData = quizData.filter(q => String(q.quiznaam).trim() !== naam);
            workbook.Sheets['quizzen'] = XLSX.utils.json_to_sheet(nieuweQuizData);
        }

        // 2. Verwijder alle woorden uit tabblad 'favorieten' die bij deze lijst horen
        if (workbook.Sheets['favorieten']) {
            let favWoordenData = XLSX.utils.sheet_to_json(workbook.Sheets['favorieten']);
            // Filter alle rijen eruit waar de kolom 'favoriet' gelijk is aan de naam
            const nieuweFavWoordenData = favWoordenData.filter(f => String(f.favoriet).trim() !== naam);
            workbook.Sheets['favorieten'] = XLSX.utils.json_to_sheet(nieuweFavWoordenData);
        }

        // Schrijf het bestand terug
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

        const woordenWb = XLSX.readFile(WOORDEN_FILE);
        const alleWoorden = XLSX.utils.sheet_to_json(woordenWb.Sheets[woordenWb.SheetNames[0]]);

        let gefilterdeWoorden = [];

        // --- GUEST BEPERKING ---
        if (req.session.rol === 'Guest') {
            const workbook = XLSX.readFile(CONFIG_FILE);
            const alleQuizzen = XLSX.utils.sheet_to_json(workbook.Sheets['quizzen']);
            
            // We pakken de allereerste quiznaam uit de Excel-lijst
            const eersteQuizNaam = alleQuizzen.length > 0 ? String(alleQuizzen[0].quiznaam).trim() : null;

            if (gezochteQuiz !== eersteQuizNaam) {
                return res.status(403).send("Als gast mag je alleen de eerste quiz uitproberen.");
            }
        }        

        // 1. CHECK OF HET EEN FAVORIETEN-QUIZ IS
        if (String(quizConf.type).toUpperCase() === 'F') {
            const favSheet = configWb.Sheets['favorieten'];
            const alleFavorietenData = favSheet ? XLSX.utils.sheet_to_json(favSheet) : [];
            
            // Filter alleen de woorden die bij deze specifieke favorietenlijst horen
            const lijstSpecifiekeWoorden = alleFavorietenData.filter(f => String(f.favoriet).trim() === gezochteQuiz);

            // Zoek de volledige data op in de hoofdbestand (woorden.xlsx)
            gefilterdeWoorden = alleWoorden.filter(w => {
                return lijstSpecifiekeWoorden.some(f => 
                    String(f.taal).trim().toLowerCase() === String(w.taal).trim().toLowerCase() &&
                    String(f.boek).trim().toLowerCase() === String(w.boek).trim().toLowerCase() &&
                    String(f.volgnr) == String(w.volgnr) // Losse vergelijking voor getal/string
                );
            });
        } else {
            // 2. NORMALE QUIZ LOGICA (Tijdelijke quiz of vaste quiz)
            const match = (val1, val2) => {
                if (!val2) return true;
                return String(val1).trim().toLowerCase() === String(val2).trim().toLowerCase();
            };

            gefilterdeWoorden = alleWoorden.filter(w => {
                // Basis filters: Taal en Boek
                if (!match(w.taal, quizConf.taal) || !match(w.boek, quizConf.boek)) return false;

                // Prioriteit: Hoofdstuk
                if (quizConf.hoofdstuk && String(quizConf.hoofdstuk).trim() !== "") {
                    return match(w.hoofdstuk, quizConf.hoofdstuk);
                } 
                
                // Geen hoofdstuk? Gebruik reeks volgnummers
                const nVanaf = quizConf.volgnrVanaf ? Number(quizConf.volgnrVanaf) : -Infinity;
                const nTot = quizConf.volgnrTot ? Number(quizConf.volgnrTot) : Infinity;
                const wNum = Number(w.volgnr);

                return wNum >= nVanaf && wNum <= nTot;
            });
        }

        if (gefilterdeWoorden.length === 0) {
            return res.status(404).send("Geen woorden gevonden voor deze selectie.");
        }

        // 3. QUIZ MIX-LOGICA (Vertalingen omkeren en opties genereren)
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

        // 4. VRAGEN SCHUDDEN EN TERUGSTUREN
        const gerandomiseerdeVragen = quizMix.sort(() => Math.random() - 0.5);

        res.json({
            type: quizConf.type,
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
