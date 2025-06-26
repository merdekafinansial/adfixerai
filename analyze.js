const fetch = require('node-fetch');

// Helper function to make API calls to Gemini
async function makeApiCall(prompt, schema, apiKey) {
    const payload = {
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: "application/json", responseSchema: schema }
    };
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;
    
    const response = await fetch(apiUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    
    if (!response.ok) {
        // Try to get the detailed error message from Google's response body
        const errorBody = await response.json().catch(() => response.text());
        const informativeError = new Error(`Permintaan API Google gagal. Status: ${response.status}.`);
        informativeError.details = errorBody; // Attach the detailed body
        throw informativeError;
    }
    
    const result = await response.json();
    if (result.candidates?.[0]?.content?.parts?.[0]?.text) {
        try {
            return JSON.parse(result.candidates[0].content.parts[0].text);
        } catch (e) {
            console.error("Gagal parsing JSON dari AI:", result.candidates[0].content.parts[0].text);
            throw new Error("Menerima respons JSON yang tidak valid dari AI.");
        }
    }

    if (result.candidates?.[0]?.finishReason === 'SAFETY' || result.candidates?.[0]?.finishReason === 'RECITATION') {
         throw new Error("Respons dari AI diblokir karena alasan keamanan atau sitasi.");
    }
    throw new Error("Menerima respons tidak valid atau kosong dari AI.");
}

// Main handler for the serverless function
exports.handler = async (event) => {
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: JSON.stringify({ error: "Method Not Allowed" }) };
    }

    try {
        const { formData, csvData } = JSON.parse(event.body);
        const apiKey = process.env.GEMINI_API_KEY;

        if (!apiKey) {
            throw new Error("API Key tidak ditemukan di environment variables.");
        }

        // --- DIVIDE AND CONQUER LOGIC ---
        // Task 1: Get Diagnosis Report
        const diagnosisPrompt = `Anda adalah AdFixer.AI. Buat laporan analisis 2 bagian berdasarkan data ini.\n- Konteks: ${JSON.stringify(formData)}\n- Data CSV: \`\`\`${csvData}\`\`\`\nBuatlah output JSON sesuai skema.`;
        const diagnosisSchema = { type: "OBJECT", properties: { diagnosisSummary: { type: "STRING" }, mainProblems: { type: "ARRAY", items: { type: "STRING" } } } };
        const diagnosisPart = makeApiCall(diagnosisPrompt, diagnosisSchema, apiKey);

        // Task 2: Get Planning Report
        const planningPrompt = `Anda adalah AdFixer.AI. Buat rencana & kesimpulan 2 bagian berdasarkan konteks ini.\n- Konteks: ${JSON.stringify(formData)}\nBuatlah output JSON sesuai skema.`;
        const planningSchema = { type: "OBJECT", properties: { splitTestPlan: { type: "ARRAY", items: { type: "OBJECT", properties: { day: { type: "STRING" }, experiment: { type: "STRING" }, goal: { type: "STRING" } } } }, conclusion: { type: "STRING" } } };
        const planningPart = makeApiCall(planningPrompt, planningSchema, apiKey);

        // Task 3: Get Creative Report
        const octavePersona = `You are OCTAVE // TextStopper Edition — a rebel-mentor AI. Your language is Indonesian, with a 'jaded warung kopi' tone - brutal, ringkas, absurd. Use the Split Shock Structure: [HOOK SINGKAT], [KALIMAT ABSURD ATAU MIKIR], [CTA BRUTAL]. Avoid safe words. Map HOOK to headline, BODY to subheadline, and CTA to cta.`;
        const creativePrompt = `Anda adalah AdFixer.AI, ahli strategi iklan provokatif. Buat rekomendasi iklan 2 bagian.\n- Konteks: ${JSON.stringify(formData)}\nInstruksi Iklan: Gunakan bahasa yang memicu, kontroversial, dan satir. Buat 2 iklan gambar dan 1 video. Jika gaya 'Strike', adopsi persona: "${octavePersona}".\nInstruksi Gambar: Prompt harus detail, menampilkan orang Indonesia, dan diakhiri dengan "--ar 4:5".\nBuat output JSON.`;
        const creativeSchema = { type: "OBJECT", properties: { adRecommendations: { type: "OBJECT", properties: { imageAds: { type: "ARRAY", items: { type: "OBJECT", properties: { headline: { type: "STRING" }, subheadline: { type: "STRING" }, cta: { type: "STRING" } } } }, videoAd: { type: "OBJECT", properties: { title: { type: "STRING" }, script: { type: "STRING" } } } } }, imageRecommendations: { type: "ARRAY", items: { type: "OBJECT", properties: { adName: { type: "STRING" }, prompt: { type: "STRING" } } } } } };
        const creativePart = makeApiCall(creativePrompt, creativeSchema, apiKey);
        
        const [diagnosisResult, planningResult, creativeResult] = await Promise.all([diagnosisPart, planningPart, creativePart]);
        
        const fullReport = { ...diagnosisResult, ...planningResult, ...creativeResult };

        return {
            statusCode: 200,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(fullReport)
        };

    } catch (error) {
        console.error('Error di serverless function:', error);
        return {
            statusCode: 500,
            headers: { "Content-Type": "application/json" },
            // Send back the generic message AND the detailed one if available
            body: JSON.stringify({ 
                error: error.message, 
                details: error.details || "Tidak ada detail teknis tambahan." 
            })
        };
    }
};
