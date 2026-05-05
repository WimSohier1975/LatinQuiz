const express = require('express');
const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.static('public'));

const EXCEL_FILE = 'vragen.xlsx';
const PORT = process.env.PORT || 3000;

app.get('/api/quizzen', (req, res) => {
    if (!fs.existsSync(EXCEL_FILE)) return res.status(404).json([]);
    const workbook = XLSX.readFile(EXCEL_FILE);
    res.json(workbook.SheetNames);
});

app.get('/api/vragen/:sheetName', (req, res) => {
    try {
        const workbook = XLSX.readFile(EXCEL_FILE);
        const sheet = workbook.Sheets[req.params.sheetName];
        const data = XLSX.utils.sheet_to_json(sheet);

        // We halen de pool van opties nu uit de nieuwe kolommen: 'grondwoord' en 'vertaling'
        const alleGrondwoorden = data.map(r => String(r.grondwoord || ""));
        const alleVertalingen = data.map(r => String(r.vertaling || ""));

        const vragenMix = data.map(r => {
            const vText = r.grondwoord || "";
            const cText = r.vertaling || ""; 
            const volgNummer = r.volgnr ? `(${r.volgnr}) ` : ""; // Pakt het nummer en zet er een spatie achter
            
            const omdraaien = Math.random() > 0.5;
            let displayVraag, goedAntwoord, pool;

            if (omdraaien) {
                displayVraag = String(cText);
                goedAntwoord = String(vText);
                pool = alleGrondwoorden;
            } else {
                displayVraag = String(vText);
                goedAntwoord = String(cText);
                pool = alleVertalingen;
            }

            let fouteOpties = [...new Set(pool.filter(a => a !== goedAntwoord && a !== ""))]
                .sort(() => 0.5 - Math.random())
                .slice(0, 3);

            let opties = [goedAntwoord, ...fouteOpties].sort(() => 0.5 - Math.random());

            return {
                vraag: displayVraag,
                antwoorden: opties,
                correct: opties.indexOf(goedAntwoord),
                openAntwoord: r.middenkolom || "",
                tip: volgNummer + (r.afleiding || "") 
            };
        });
        
        res.json(vragenMix);
    } catch (e) {
        console.error(e);
        res.status(500).send("Fout bij laden van mix-data");
    }
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server actief op poort ${PORT}`);
});
