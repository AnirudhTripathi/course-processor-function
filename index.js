const express = require('express');
const app = express();

app.post('/', (req, res) => {
    console.log('Hello World! The new trigger worked!');
    res.status(204).send();
});

const port = parseInt(process.env.PORT) || 8080;
app.listen(port, () => {
    console.log(`Hello World server listening on port ${port}`);
});