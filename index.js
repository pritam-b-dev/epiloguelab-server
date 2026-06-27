const express = require("express");
const cors = require("cors");
const { MongoClient, ServerApiVersion } = require("mongodb");
require("dotenv").config();

const app = express();
const port = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

const uri = process.env.MONGODB_URI;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    await client.connect();

    // Database and Collections
    const database = client.db("epiloguelab_db");

    const lessonsCollection = database.collection("lessons");
    const usersCollection = database.collection("users");
    const favoritesCollection = database.collection("favorites");
    const commentsCollection = database.collection("comments");
    const reportsCollection = database.collection("reports");
    const sessionCollection = database.collection("session");

    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!",
    );
  } catch (error) {
    console.error("MongoDB connection error:", error);
  }
}

run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("Digital Life Lessons Server Running");
});

app.listen(port, () => {
  console.log(`epiloguelab server listening on port ${port}`);
});
