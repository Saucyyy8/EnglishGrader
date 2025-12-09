const express = require('express');
const cors = require('cors');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 8000;

// Middleware
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json({ limit: '50mb' }));

// Health check
app.get('/', (req, res) => {
    res.json({ status: 'ok', message: 'English Grader Backend is running' });
});

// Grade endpoint
app.post('/grade', async (req, res) => {
    try {
        const { question, images } = req.body;

        if (!question) {
            return res.status(400).json({ error: 'No question provided' });
        }
        if (!images || images.length === 0) {
            return res.status(400).json({ error: 'No images provided' });
        }

        console.log(`Received submission for question: ${question.substring(0, 50)}... with ${images.length} images`);

        // Construct image tokens for Qwen VL
        const imageTokens = images.map(() => '<image>').join('');
        const textPrompt = `${imageTokens}
You are an expert English teacher grading a student's composition.
The student chose this question: "${question}"

Your task is to:
1. Read the handwritten answer from the provided images (read ALL pages).
2. Evaluate it based on grammar, sentence structure, coherence, spelling, and expression.
3. Be lenient but honest. Do not punish harshly, but highlight mistakes.
4. Return the result in STRICT JSON format with no markdown blocks. The JSON must have this structure:
{
  "score": <number 0-10>,
  "errors": [
    {
      "page": <page_number>,
      "line": <line_number_approx>,
      "text": "<full_line_text>",
      "issue": "<what_is_wrong>",
      "fix": "<corrected_version>"
    }
  ],
  "feedback": "<overall_feedback_paragraph>"
}
`;

        // Build content array
        const content = [{ type: 'text', text: textPrompt }];

        images.forEach(img => {
            const base64Data = img.includes(',') ? img : `data:image/jpeg;base64,${img}`;
            content.push({
                type: 'image_url',
                image_url: { url: base64Data }
            });
        });

        // Call Fireworks API
        const response = await fetch('https://api.fireworks.ai/inference/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${process.env.FIREWORKS_API_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: 'accounts/fireworks/models/qwen3-vl-235b-a22b-instruct',
                messages: [{ role: 'user', content }],
                max_tokens: 4096,
                temperature: 0.6,
                response_format: { type: 'json_object' }
            })
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error('Fireworks API Error:', errorText);
            return res.status(500).json({ error: 'Failed to communicate with AI provider', details: errorText });
        }

        const result = await response.json();
        let rawContent = result.choices[0].message.content;

        // Clean markdown if present
        if (rawContent.startsWith('```json')) {
            rawContent = rawContent.replace(/```json/g, '').replace(/```/g, '');
        }

        try {
            const parsedResult = JSON.parse(rawContent);
            res.json(parsedResult);
        } catch (parseError) {
            console.error('Failed to parse AI response:', rawContent);
            res.status(500).json({ error: 'Invalid JSON response from AI', raw: rawContent });
        }

    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: error.message });
    }
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
});
