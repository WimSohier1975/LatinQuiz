const express = require('express');
const XLSX = require('xlsx');
const fs = require('fs');
const app = express();

app.use(express.static('public'));
app.use(express.json());

const WOORDEN_FILE = 'woorden.xlsx';
const CONFIG_FILE = 'config.xlsx';
const PORT = process.env.PORT || 3000;

// 1. Haal de quiznamen op uit config.xlsx
app.get('/api/quizzen', (req, res) => {
    try {
        const workbook = XLSX.readFile(CONFIG_FILE);
        const sheet = workbook.Sheets['quizzen'];
        const data = XLSX.utils.sheet_to_json(sheet);
        res.json(data.map(q => q.quiznaam)); 
    } catch (e) {
        res.status(404).json([]);
    }
});

app.post('/api/quizzen', (req, res) => {
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
app.get('/api/quizzen/tijdelijk', (req, res) => {
    try {
        const workbook = XLSX.readFile(CONFIG_FILE);
        const data = XLSX.utils.sheet_to_json(workbook.Sheets['quizzen']);
        const tijdelijk = data.filter(q => q.type === 'T').map(q => q.quiznaam);
        res.json(tijdelijk);
    } catch (e) { res.json([]); }
});

//Verwijder een tijdelijke quiz
app.delete('/api/quizzen/:naam', (req, res) => {
    try {
        const naam = decodeURIComponent(req.params.naam);
        const workbook = XLSX.readFile(CONFIG_FILE);
        let data = XLSX.utils.sheet_to_json(workbook.Sheets['quizzen']);
        
        // Filter alles behalve de te verwijderen TIJDELIJKE quiz
        const nieuweData = data.filter(q => !(q.quiznaam === naam && q.type === 'T'));
        
        const newSheet = XLSX.utils.json_to_sheet(nieuweData);
        workbook.Sheets['quizzen'] = newSheet;
        XLSX.writeFile(workbook, CONFIG_FILE);
        res.json({ success: true });
    } catch (e) { res.status(500).send("Verwijderen mislukt."); }
});

// 2. Genereer quiz met filters voor taal, boek, hoofdstuk en volgnummers
app.get('/api/vragen/:quiznaam', (req, res) => {
    try {
        const configWb = XLSX.readFile(CONFIG_FILE);
        const configData = XLSX.utils.sheet_to_json(configWb.Sheets['quizzen']);
        
        const gezochteQuiz = decodeURIComponent(req.params.quiznaam);
        const quizConf = configData.find(q => String(q.quiznaam).trim() === gezochteQuiz.trim());

        if (!quizConf) return res.status(404).send("Quiz niet gevonden");

        const woordenWb = XLSX.readFile(WOORDEN_FILE);
        const alleWoorden = XLSX.utils.sheet_to_json(woordenWb.Sheets[woordenWb.SheetNames[0]]);

        // HULPFUNCTIE: Vergelijkt waarden ongeacht type of spaties
        const match = (val1, val2) => {
            if (!val2) return true; // Als config leeg is, is het een match
            return String(val1).trim().toLowerCase() === String(val2).trim().toLowerCase();
        };

        const gefilterdeWoorden = alleWoorden.filter(w => {
            // 1. Basis filters: Taal en Boek
            if (!match(w.taal, quizConf.taal) || !match(w.boek, quizConf.boek)) return false;

            // 2. Prioriteit: Hoofdstuk matcht? Dan negeren we de volgnummer-reeks
            if (quizConf.hoofdstuk && String(quizConf.hoofdstuk).trim() !== "") {
                return match(w.hoofdstuk, quizConf.hoofdstuk);
            } 
            
            // 3. Geen hoofdstuk? Gebruik de reeks volgnrs
            const nVanaf = quizConf.volgnrVanaf ? Number(quizConf.volgnrVanaf) : -Infinity;
            const nTot = quizConf.volgnrTot ? Number(quizConf.volgnrTot) : Infinity;
            const wNum = Number(w.volgnr);

            return wNum >= nVanaf && wNum <= nTot;
        });

        // DEBUGGING: Kijk in je terminal/command prompt voor dit getal!
        console.log(`Poging laden: [${gezochteQuiz}] | Gevonden: ${gefilterdeWoorden.length} woorden`);

        if (gefilterdeWoorden.length === 0) {
            return res.status(404).send("Geen woorden gevonden. Check of de kolomnamen in Excel 'taal', 'boek', etc. zijn (zonder hoofdletters).");
        }

        // Bestaande mix-logica...
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
                tip: `(${r.volgnr || '-'}) ${r.afleiding || ""}`
            };
        });

        res.json(quizMix);
    } catch (e) {
        console.error("KRITIEKE FOUT:", e);
        res.status(500).send("Fout bij verwerken Excel data");
    }
});

// 3. Beschikbare opties uit woordenlijst om nieuwe quiz te kunnen maken
app.get('/api/opties', (req, res) => {
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
