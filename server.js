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
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ limit: '100mb', extended: true }));

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

        const imageTokens = images.map(() => '<image>').join('');

        // Check if this is the picture question (question 5)
        const isPictureQuestion = question.includes("Study the picture given below");

        let questionContext = `The student chose this question: "${question}"`;

        if (isPictureQuestion) {
            questionContext += `
            
CONTEXT FOR THE PICTURE QUESTION:
The student is writing based on a picture. Since you cannot see the original picture prompt, here is a detailed description of it to help you judge if the student's composition is relevant:

Detailed Description of the Picture:
The picture is a black-and-white photograph showing two young children engaged in the act of planting a sapling. The scene appears to be set outdoors, possibly in a garden, park, or a patch of open land surrounded by trees.
Both children are squatting close to the ground, indicating active participation rather than passive observation. One child, positioned slightly to the right, is holding the sapling upright with both hands, ensuring that it stands straight in the soil. The other child, on the left, seems to be assisting by arranging or pressing the soil around the base of the plant. Their postures suggest cooperation, care, and shared responsibility.
The sapling is thin and young, with a few delicate leaves at the top, symbolising new life, growth, and hope. The soil around it looks freshly disturbed, indicating that the planting has just taken place. The ground is uneven and natural, not manicured, reinforcing the idea that this is a real effort rather than a symbolic or staged activity.
In the background, tall trees and foliage can be seen, creating a natural setting and giving depth to the image. The trees appear mature, contrasting with the fragile sapling in the foreground. This contrast subtly highlights the idea that today’s small actions can lead to tomorrow’s strong outcomes.
The children’s facial expressions, though not very sharp due to the grainy quality of the image, appear focused and sincere. There is no sense of playfulness or distraction; instead, the mood is serious yet positive, suggesting that the children understand the importance of what they are doing.
Overall, the picture conveys themes of environmental awareness, responsibility, teamwork, and nurturing nature. It suggests that protecting the environment begins at a young age and that collective effort is essential for a greener future.
`;
        }

        const textPrompt = `${imageTokens}
You are an expert English teacher grading a student's composition.
${questionContext}

Your task is to:
1. Read the handwritten answer from ALL provided images.
2. Evaluate based on:
   - Sentence formation and structure
   - Grammatical correctness
   - Coherence and flow
   - Only significantly wrong spelling mistakes (ignore minor typos)
   ${isPictureQuestion ? '- Relevance to the picture description provided above' : ''}
3. Essay length consideration: 2 pages is ideal for good marks.

SCORING GUIDELINES (Moderate Stringency):
- Be moderate in your marking. Do not be too lenient, but do not be overly strict either.
- Reward creativity and good expression, but penalize clear grammatical errors and lack of structure.
- 9-10: Exceptional work, deep understanding, near perfect language.
- 7-8: Good work, clear expression, minor errors.
- 5-6: Average, understandable but with noticeable grammatical or structural issues.
- 3-4: Below average, struggling with sentence formation.
- 0-2: Poor, incoherent or irrelevant.

Assess realistically. Not every essay deserves a 7 or 8. Use the full range if necessary, but aim for a fair, balanced, moderate standard.

Return STRICT JSON (no markdown):
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
  ]
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
