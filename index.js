const functions = require("firebase-functions");
const admin = require("firebase-admin");
const { PredictionServiceClient } = require("@google-cloud/aiplatform").v1;

admin.initializeApp();

const PROJECT_ID = "dr-panic"; 
const LOCATION = "europe-west3"; 
const INDEX_ENDPOINT_ID = "3016549733222055936"; 


const clientOptions = { apiEndpoint: `${LOCATION}-aiplatform.googleapis.com` };
const predictionServiceClient = new PredictionServiceClient(clientOptions);

exports.processCourseForVectorSearch = functions.firestore
  .document("courses/{courseId}")
  .onWrite(async (change, context) => {
    const courseId = context.params.courseId;
    const documentData = change.after.exists ? change.after.data() : null;
    const oldDocumentData = change.before.exists ? change.before.data() : null;

    if (!documentData) {
      console.log(`Course ${courseId} deleted. No action taken.`);
      return null;
    }

    const textToEmbed = documentData.course_content;

    if (oldDocumentData && textToEmbed === oldDocumentData.course_content) {
        console.log(`Content for ${courseId} has not changed. Skipping embedding.`);
        return null;
    }

    if (!textToEmbed || textToEmbed.trim() === "") {
      console.log(`No content to embed for document ${courseId}.`);
      return null;
    }
    console.log(`Processing document: ${courseId}`);

    const endpoint = `projects/${PROJECT_ID}/locations/${LOCATION}/publishers/google/models/text-embedding-004`;
    const instances = [{ content: textToEmbed }];
    const request = { endpoint, instances };

    const [response] = await predictionServiceClient.predict(request);
    const embedding = response.predictions[0].structValue.fields.embedding.listValue.values.map(v => v.numberValue);

    if (!embedding) {
        console.error("Failed to generate embedding for", courseId);
        return null;
    }
    console.log(`Successfully generated embedding for ${courseId}. Dimension: ${embedding.length}`);

    const indexEndpoint = `projects/${PROJECT_ID}/locations/${LOCATION}/indexEndpoints/${INDEX_ENDPOINT_ID}`;
    const datapoints = [{
        datapoint_id: courseId,
        feature_vector: embedding,
    }];
    const upsertRequest = { indexEndpoint, datapoints };

    try {
        await predictionServiceClient.upsertDatapoints(upsertRequest);
        console.log(`Successfully upserted vector for ${courseId} to index.`);
    } catch (error) {
        console.error(`Error upserting vector for ${courseId}:`, error);
    }
    
    return null;
  });