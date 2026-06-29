const express = require("express");
const cors = require("cors");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
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

    //user related api

    app.get("/api/users", verifyToken, verifyAdmin, async (req, res) => {
      try {
        const users = await usersCollection.find().toArray();

        const usersWithCount = await Promise.all(
          users.map(async (user) => {
            const count = await lessonsCollection.countDocuments({
              creatorId: user._id.toString(),
            });
            return { ...user, lessonCount: count };
          }),
        );

        res.send(usersWithCount);
      } catch (error) {
        res.status(500).send({ message: "Error fetching users", error });
      }
    });

    app.patch(
      "/api/users/:id/role",
      verifyToken,
      verifyAdmin,
      async (req, res) => {
        try {
          const id = req.params.id;
          const { role } = req.body;

          const result = await usersCollection.updateOne(
            { _id: new ObjectId(id) },
            { $set: { role: role } },
          );
          res.send(result);
        } catch (error) {
          res.status(500).send({ message: "Error updating role", error });
        }
      },
    );

    app.patch("/api/users/profile", verifyToken, async (req, res) => {
      try {
        const { name, photoURL } = req.body;

        const result = await usersCollection.updateOne(
          { _id: new ObjectId(req.user._id) },
          { $set: { name: name, photoURL: photoURL } },
        );
        res.send(result);
      } catch (error) {
        res.status(500).send({ message: "Error updating profile", error });
      }
    });

    //lesson related api
    app.get("/api/lessons", async (req, res) => {
      try {
        const query = { visibility: "public" };

        //filter search
        if (req.query.search) {
          query.$or = [
            { title: { $regex: req.query.search, $options: "i" } },
            { description: { $regex: req.query.search, $options: "i" } },
          ];
        }
        //by category
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

        // Sort logic
        const sortObj =
          req.query.sort === "mostSaved"
            ? { likesCount: -1 }
            : { createdAt: -1 };

        // Pagination logic
        if (req.query.page) {
          const page = parseInt(req.query.page);
          const perPage = parseInt(req.query.perPage) || 6;
          const skipItems = (page - 1) * perPage;

          const total = await lessonsCollection.countDocuments(query);
          const lessons = await lessonsCollection
            .find(query)
            .sort(sortObj)
            .skip(skipItems)
            .limit(perPage)
            .toArray();

          res.send({ lessons, total });
        } else {
          // if no page
          const result = await lessonsCollection
            .find(query)
            .sort(sortObj)
            .toArray();
          res.send(result);
        }
      } catch (error) {
        res.status(500).send({ message: "Error fetching lessons", error });
      }
    });

    app.get("/api/lessons/:id", async (req, res) => {
      const id = req.params.id;
      const result = await lessonsCollection.findOne({ _id: new ObjectId(id) });
      res.send(result);
    });

    app.get("/api/my/lessons", verifyToken, async (req, res) => {
      const query = { creatorId: req.user._id.toString() };
      const result = await lessonsCollection
        .find(query)
        .sort({ createdAt: -1 })
        .toArray();
      res.send(result);
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

    app.post("/api/lessons", verifyToken, async (req, res) => {
      const lessonData = req.body;
      const newLesson = {
        ...lessonData,
        creatorId: req.user._id.toString(),
        creatorName: req.user.name,
        creatorPhoto: req.user.photoURL || "",
        createdAt: new Date(),
        updatedAt: new Date(),
        likesCount: 0,
        likes: [],
        isFeatured: false,
        isReviewed: false,
      };

      const result = await lessonsCollection.insertOne(newLesson);
      res.send(result);
    });

    app.patch("/api/lessons/:id", verifyToken, async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };

      const lesson = await lessonsCollection.findOne(query);

      if (!lesson) {
        return res.status(404).send({ message: "Lesson not found" });
      }

      if (
        req.user._id.toString() !== lesson.creatorId &&
        req.user.role !== "admin"
      ) {
        return res.status(403).send({ message: "Forbidden access" });
      }

      const updateDoc = {
        $set: {
          ...req.body,
          updatedAt: new Date(),
        },
      };

      const result = await lessonsCollection.updateOne(query, updateDoc);
      res.send(result);
    });

    app.patch("/api/lessons/:id/like", verifyToken, async (req, res) => {
      const id = req.params.id;
      const userId = req.user._id.toString();
      const query = { _id: new ObjectId(id) };

      const lesson = await lessonsCollection.findOne(query);

      if (!lesson) {
        return res.status(404).send({ message: "Lesson not found" });
      }

      const alreadyLiked = lesson.likes?.includes(userId);
      let updateDoc;
      let updatedCount;

      if (alreadyLiked) {
        updateDoc = {
          $pull: { likes: userId },
          $inc: { likesCount: -1 },
        };
        updatedCount = (lesson.likesCount || 0) - 1;
      } else {
        updateDoc = {
          $push: { likes: userId },
          $inc: { likesCount: 1 },
        };
        updatedCount = (lesson.likesCount || 0) + 1;
      }

      await lessonsCollection.updateOne(query, updateDoc);

      res.send({ liked: !alreadyLiked, likesCount: updatedCount });
    });

    app.patch("/api/lessons/:id/visibility", verifyToken, async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };

      const lesson = await lessonsCollection.findOne(query);

      if (!lesson) {
        return res.status(404).send({ message: "Lesson not found" });
      }

      if (
        req.user._id.toString() !== lesson.creatorId &&
        req.user.role !== "admin"
      ) {
        return res.status(403).send({ message: "Forbidden access" });
      }

      const result = await lessonsCollection.updateOne(query, {
        $set: {
          visibility: req.body.visibility,
          updatedAt: new Date(),
        },
      });

      res.send(result);
    });

    app.patch(
      "/api/lessons/:id/feature",
      verifyToken,
      verifyAdmin,
      async (req, res) => {
        const id = req.params.id;
        const query = { _id: new ObjectId(id) };

        const lesson = await lessonsCollection.findOne(query);

        if (!lesson) {
          return res.status(404).send({ message: "Lesson not found" });
        }

        const newFeaturedStatus = !lesson.isFeatured;

        const result = await lessonsCollection.updateOne(query, {
          $set: {
            isFeatured: newFeaturedStatus,
            updatedAt: new Date(),
          },
        });

        res.send({ isFeatured: newFeaturedStatus });
      },
    );

    app.delete("/api/lessons/:id", verifyToken, async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };

      const lesson = await lessonsCollection.findOne(query);

      if (!lesson) {
        return res.status(404).send({ message: "Lesson not found" });
      }

      if (
        req.user._id.toString() !== lesson.creatorId &&
        req.user.role !== "admin"
      ) {
        return res.status(403).send({ message: "Forbidden access" });
      }

      const result = await lessonsCollection.deleteOne(query);
      res.send(result);
    });

    //comment related api

    app.get("/api/comments", async (req, res) => {
      try {
        const { lessonId } = req.query;
        const comments = await commentsCollection
          .find({ lessonId })
          .sort({ createdAt: -1 })
          .toArray();
        res.send(comments);
      } catch (error) {
        res.status(500).send({ message: "Failed to fetch comments", error });
      }
    });

    app.post("/api/comments", verifyToken, async (req, res) => {
      try {
        const newComment = {
          lessonId: req.body.lessonId,
          text: req.body.text,
          userId: req.user._id.toString(),
          userName: req.user.name,
          userPhoto: req.user.photoURL || "",
          createdAt: new Date(),
        };

        const result = await commentsCollection.insertOne(newComment);
        res.send(result);
      } catch (error) {
        res.status(500).send({ message: "Failed to post comment", error });
      }
    });

    //favourite related api

    app.get("/api/favorites", verifyToken, async (req, res) => {
      const { userId } = req.query;

      if (req.user._id.toString() !== userId) {
        return res.status(403).send({ message: "Forbidden access" });
      }

      const favorites = await favoritesCollection.find({ userId }).toArray();
      const lessonIds = favorites.map((f) => new ObjectId(f.lessonId));
      const lessons = await lessonsCollection
        .find({ _id: { $in: lessonIds } })
        .toArray();

      const result = favorites.map((fav) => ({
        ...fav,
        lesson: lessons.find((l) => l._id.toString() === fav.lessonId),
      }));

      res.send(result);
    });

    app.post("/api/favorites", verifyToken, async (req, res) => {
      const { userId, lessonId } = req.body;
      const result = await favoritesCollection.insertOne({
        userId,
        lessonId,
        savedAt: new Date(),
      });
      res.send(result);
    });

    app.delete("/api/favorites/:lessonId", verifyToken, async (req, res) => {
      const { lessonId } = req.params;
      const { userId } = req.query;
      const result = await favoritesCollection.deleteOne({ lessonId, userId });
      res.send(result);
    });

    //report related api

    app.post("/api/reports", verifyToken, async (req, res) => {
      try {
        const { lessonId, reason } = req.body;
        const newReport = {
          lessonId,
          reporterUserId: req.user._id.toString(),
          reporterEmail: req.user.email,
          reason,
          timestamp: new Date(),
        };

        const result = await reportsCollection.insertOne(newReport);
        res.send(result);
      } catch (error) {
        res.status(500).send({ message: "Failed to submit report" });
      }
    });

    app.get("/api/reports", verifyToken, verifyAdmin, async (req, res) => {
      try {
        const allReports = await reportsCollection.find().toArray();

        const groupedReports = allReports.reduce((acc, report) => {
          const { lessonId } = report;
          if (!acc[lessonId]) {
            acc[lessonId] = { lessonId, count: 0, reports: [] };
          }
          acc[lessonId].count += 1;
          acc[lessonId].reports.push(report);
          return acc;
        }, {});

        res.send(Object.values(groupedReports));
      } catch (error) {
        res.status(500).send({ message: "Failed to fetch reports" });
      }
    });

    app.delete(
      "/api/reports/lesson/:lessonId",
      verifyToken,
      verifyAdmin,
      async (req, res) => {
        try {
          const { lessonId } = req.params;
          const result = await reportsCollection.deleteMany({ lessonId });
          res.send(result);
        } catch (error) {
          res.status(500).send({ message: "Failed to delete reports" });
        }
      },
    );

    //admin related api
    app.get("/api/admin/stats", verifyToken, verifyAdmin, async (req, res) => {
      try {
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const stats = {
          totalUsers: await usersCollection.countDocuments(),
          totalLessons: await lessonsCollection.countDocuments({
            visibility: "public",
          }),
          totalReports: await reportsCollection.countDocuments(),
          premiumUsers: await usersCollection.countDocuments({
            isPremium: true,
          }),
          todayLessons: await lessonsCollection.countDocuments({
            createdAt: { $gte: today },
          }),
          featuredLessons: await lessonsCollection.countDocuments({
            isFeatured: true,
          }),
        };

        res.send(stats);
      } catch (error) {
        res.status(500).send({ message: "Error fetching admin stats", error });
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
