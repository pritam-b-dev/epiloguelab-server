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

    // Middleware: Verify Token
    const verifyToken = async (req, res, next) => {
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return res.status(401).send({ message: "unauthorized access" });
      }
      const token = authHeader.split(" ")[1];

      const session = await sessionCollection.findOne({ token: token });
      if (!session) {
        return res.status(401).send({ message: "unauthorized access" });
      }

      const user = await usersCollection.findOne({ _id: session.userId });
      if (!user) {
        return res.status(401).send({ message: "unauthorized access" });
      }

      req.user = user;
      next();
    };

    // Middleware: Verify Admin
    const verifyAdmin = (req, res, next) => {
      if (req.user?.role !== "admin") {
        return res.status(403).send({ message: "forbidden access" });
      }
      next();
    };

    // Middleware: Verify User
    const verifyUser = (req, res, next) => {
      if (!req.user) {
        return res.status(401).send({ message: "unauthorized access" });
      }
      next();
    };

    //api start

    //lesson related api
    app.get("/api/lessons", async (req, res) => {
      try {
        const query = { visibility: "public" };

        if (req.query.category) {
          query.category = req.query.category;
        }
        if (req.query.emotionalTone) {
          query.emotionalTone = req.query.emotionalTone;
        }
        if (req.query.accessLevel) {
          query.accessLevel = req.query.accessLevel;
        }

        const creatorId = req.query.companyId || req.query.creatorId;
        if (creatorId) {
          query.creatorId = creatorId;
        }

        //filter search
        if (req.query.search) {
          query.$or = [
            { title: { $regex: req.query.search, $options: "i" } },
            { description: { $regex: req.query.search, $options: "i" } },
          ];
        }

        const lessons = await lessonsCollection
          .find(query)
          .sort({ createdAt: -1 })
          .toArray();
        res.send(lessons);
      } catch (error) {
        res.status(500).send({ message: "Error fetching lessons", error });
      }
    });

    app.get("/api/featured-lessons", async (req, res) => {
      try {
        const result = await lessonsCollection
          .find({ isFeatured: true, visibility: "public" })
          .limit(6)
          .toArray();
        res.send(result);
      } catch (error) {
        res.status(500).send({ message: "Error fetching featured lessons" });
      }
    });

    app.get("/api/most-saved", async (req, res) => {
      try {
        const result = await lessonsCollection
          .find({ visibility: "public" })
          .sort({ likesCount: -1 })
          .limit(6)
          .toArray();
        res.send(result);
      } catch (error) {
        res.status(500).send({ message: "Error fetching most saved lessons" });
      }
    });

    app.get("/api/top-contributors", async (req, res) => {
      try {
        const result = await lessonsCollection
          .aggregate([
            { $match: { visibility: "public" } },
            {
              $group: {
                _id: "$creatorId",
                name: { $first: "$creatorName" },
                photo: { $first: "$creatorPhoto" },
                count: { $sum: 1 },
              },
            },
            { $sort: { count: -1 } },
            { $limit: 6 },
          ])
          .toArray();
        res.send(result);
      } catch (error) {
        res.status(500).send({ message: "Error fetching top contributors" });
      }
    });

    //api ends

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
