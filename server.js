const express = require('express');
const XLSX = require('xlsx');
const fs = require('fs');
const app = express();

app.use(express.static('public'));
const EXCEL_FILE = 'vragen.xlsx';

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

        const vragen = data.map(r => ({
            vraag: r.vraag,
            antwoorden: [r.A, r.B, r.C, r.D].filter(a => a !== undefined),
            correct: ["A","B","C","D"].indexOf(r.correct),
            openAntwoord: r.open,
            tip: r.tip 
        }));
        res.json(vragen);
    } catch (e) {
        res.status(500).send("Fout bij laden");
    }
});

app.listen(3000, () => console.log(`Server draait op http://localhost:3000`));
