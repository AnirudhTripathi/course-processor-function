const express = require('express');
const admin = require('firebase-admin');
const { PredictionServiceClient } = require("@google-cloud/aiplatform").v1;

const app = express();
app.use(express.json());

admin.initializeApp();


const PROJECT_ID = "dr-panic";
const LOCATION = "europe-west3";
const INDEX_ENDPOINT_ID = "3016549733222055936"; 

const clientOptions = { apiEndpoint: `${LOCATION}-aiplatform.googleapis.com` };
const predictionServiceClient = new PredictionServiceClient(clientOptions);


const firestoreToJs = (fields) => {
    if (!fields) return {};
    const result = {};
    for (const [key, value] of Object.entries(fields)) {
        const valueType = Object.keys(value)[0];
        result[key] = value[valueType];
    }
    return result;
};

app.post('/', async (req, res) => {
    console.log('Received event:', JSON.stringify(req.body, null, 2));

    
    const firestoreEvent = req.body.data;
    if (!firestoreEvent) {
        console.log('Not a valid Firestore event. Exiting.');
        return res.status(200).send('OK');
    }

    const documentData = firestoreToJs(firestoreEvent.value?.fields);
    const oldDocumentData = firestoreToJs(firestoreEvent.oldValue?.fields);
    
    
    const subject = req.body.subject; 
    const courseId = subject.split('/').pop();

    if (!firestoreEvent.value) {
        console.log(`Course ${courseId} deleted. No action taken.`);
        return res.status(204).send();
    }

    const textToEmbed = documentData.course_content;
    
    if (oldDocumentData && textToEmbed === oldDocumentData.course_content) {
        console.log(`Content for ${courseId} has not changed. Skipping embedding.`);
        return res.status(204).send();
    }

    if (!textToEmbed || typeof textToEmbed !== 'string' || textToEmbed.trim() === "") {
        console.log(`No valid content to embed for document ${courseId}.`);
        return res.status(204).send();
    }
    
    console.log(`Processing document: ${courseId}`);

    try {
        
        const endpoint = `projects/${PROJECT_ID}/locations/${LOCATION}/publishers/google/models/text-embedding-004`;
        const instances = [{ content: textToEmbed }];
        const request = { endpoint, instances };

        const [response] = await predictionServiceClient.predict(request);
        const embedding = response.predictions[0].structValue.fields.embedding.listValue.values.map(v => v.numberValue);

        if (!embedding) throw new Error("Failed to generate embedding.");
        console.log(`Successfully generated embedding for ${courseId}.`);

        
        const indexEndpoint = `projects/${PROJECT_ID}/locations/${LOCATION}/indexEndpoints/${INDEX_ENDPOINT_ID}`;
        const datapoints = [{ datapoint_id: courseId, feature_vector: embedding }];
        const upsertRequest = { indexEndpoint, datapoints };
        
        await predictionServiceClient.upsertDatapoints(upsertRequest);
        console.log(`Successfully upserted vector for ${courseId} to index.`);
        
        res.status(204).send();

    } catch (error) {
        console.error(`Error processing document ${courseId}:`, error);
        res.status(500).send('Internal Server Error');
    }
});

const port = parseInt(process.env.PORT) || 8080;
app.listen(port, () => {
    console.log(`Listening on port ${port}`);
});