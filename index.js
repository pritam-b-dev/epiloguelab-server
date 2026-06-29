const express = require("express");
const cors = require("cors");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
require("dotenv").config();
const app = express();
const port = process.env.PORT || 5000;

app.use(
  cors({
    origin: process.env.CLIENT_URL || "http://localhost:3000",
    credentials: true,
    allowedHeaders: ["Content-Type", "Authorization"],
  }),
);

app.use(express.json());
const Stripe = require("stripe");
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

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
    const usersCollection = database.collection("user");
    const favoritesCollection = database.collection("favorites");
    const commentsCollection = database.collection("comments");
    const reportsCollection = database.collection("reports");
    const sessionCollection = database.collection("session");

    // Middleware: Verify Token

    const verifyToken = async (req, res, next) => {
      try {
        const authHeader = req.headers.authorization;

        console.log("=== VERIFY TOKEN START ===");
        console.log("Incoming Auth Header:", authHeader);

        if (!authHeader || !authHeader.startsWith("Bearer ")) {
          console.log("❌ Error: No Bearer token in header");
          return res.status(401).send({ message: "unauthorized access" });
        }
        const token = authHeader.split(" ")[1];
        console.log("Extracted Token from Frontend:", token);

        const session = await sessionCollection.findOne({ token: token });

        if (!session) {
          console.log(
            "❌ Error: Token not found in MongoDB session collection!",
          );
          return res.status(401).send({ message: "unauthorized access" });
        }

        console.log("✅ Session Found in DB. User ID:", session.userId);

        let rawUserId = session.userId;
        let userIdStr = rawUserId
          .toString()
          .replace(/ObjectId\(['"](.+)['"]\)/, "$1");

        const idQuery = ObjectId.isValid(userIdStr)
          ? new ObjectId(userIdStr)
          : userIdStr;

        const user = await usersCollection.findOne({ _id: idQuery });

        if (!user) {
          console.log("❌ Error: User not found in database!");
          return res.status(401).send({ message: "unauthorized access" });
        }

        console.log("✅ User Verified Successfully:", user.email);
        console.log("=== VERIFY TOKEN END ===");

        req.user = user;
        next();
      } catch (error) {
        console.error("Token verification error:", error);
        return res
          .status(500)
          .send({ message: "Internal server error in verification" });
      }
    };

    // Middleware: Verify Admin
    const verifyAdmin = (req, res, next) => {
      if (!req.user) {
        return res
          .status(401)
          .send({ message: "unauthorized access - user not found" });
      }

      const userRole = req.user?.role?.trim().toLowerCase();

      if (userRole !== "admin") {
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

    app.get(
      "/api/admin/lessons",
      verifyToken,
      verifyAdmin,
      async (req, res) => {
        try {
          console.log("📢 HIT RECEIVED ON /api/admin/lessons!");

          let query = {};

          const result = await lessonsCollection
            .find(query)
            .sort({ createdAt: -1 })
            .toArray();

          console.log("📦 DATABASE FOUND LESSONS COUNT:", result.length);

          res.send(result);
        } catch (error) {
          console.log("❌ ERROR:", error);
          res.status(500).send({ message: "Error fetching lessons", error });
        }
      },
    );
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
        const query = { visibility: { $regex: /^public$/i } };

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
      try {
        const id = req.params.id;

        const query = ObjectId.isValid(id)
          ? { _id: new ObjectId(id) }
          : { _id: id };

        const result = await lessonsCollection.findOne(query);

        if (!result) {
          return res.status(404).send({ message: "Lesson not found" });
        }

        res.send(result);
      } catch (error) {
        console.error("Error in fetching lesson details:", error);
        res.status(500).send({ message: "Internal server error" });
      }
    });

    app.get("/api/my/lessons", verifyToken, async (req, res) => {
      console.log("req.user._id:", req.user._id);
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
      try {
        const { userId } = req.query;

        if (req.user._id.toString() !== userId) {
          return res.status(403).send({ message: "Forbidden access" });
        }

        const favorites = await favoritesCollection.find({ userId }).toArray();

        const lessonQueries = favorites.map((f) =>
          ObjectId.isValid(f.lessonId) ? new ObjectId(f.lessonId) : f.lessonId,
        );

        const lessons = await lessonsCollection
          .find({ _id: { $in: lessonQueries } })
          .toArray();

        const result = favorites.map((fav) => ({
          ...fav,
          lesson: lessons.find(
            (l) => l._id.toString() === fav.lessonId.toString(),
          ),
        }));

        res.send(result);
      } catch (error) {
        res.status(500).send({ message: "Failed to fetch favorites" });
      }
    });

    app.post("/api/favorites", verifyToken, async (req, res) => {
      try {
        const { lessonId } = req.body;

        const userId = req.user._id.toString();

        if (!lessonId) {
          return res
            .status(400)
            .send({ success: false, message: "Lesson ID is required" });
        }

        const existingFavorite = await favoritesCollection.findOne({
          userId: userId,
          lessonId: lessonId,
        });

        if (existingFavorite) {
          return res
            .status(400)
            .send({ success: false, message: "Already in favorites!" });
        }

        const result = await favoritesCollection.insertOne({
          userId,
          lessonId,
          savedAt: new Date(),
        });

        console.log(
          `✅ Lesson ${lessonId} successfully saved for user: ${req.user.email}`,
        );

        res.send({ success: true, insertedId: result.insertedId });
      } catch (error) {
        console.error("Error saving favorite:", error);
        res
          .status(500)
          .send({ success: false, message: "Internal server error" });
      }
    });

    app.delete("/api/favorites/:lessonId", verifyToken, async (req, res) => {
      const { lessonId } = req.body;
      const userId = req.user._id.toString();

      const result = await favoritesCollection.deleteOne({ userId, lessonId });
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

    // payment related api
    // Stripe Setup

    app.post("/api/create-checkout-session", verifyToken, async (req, res) => {
      try {
        const session = await stripe.checkout.sessions.create({
          customer_email: req.user.email,
          line_items: [{ price: process.env.STRIPE_PRICE_ID, quantity: 1 }],
          mode: "subscription",
          metadata: {
            userId: req.user._id.toString(),
            userEmail: req.user.email,
          },
          success_url:
            process.env.CLIENT_URL +
            "/pricing/success?session_id={CHECKOUT_SESSION_ID}",
          cancel_url: process.env.CLIENT_URL + "/pricing/cancel",
        });

        res.json({ url: session.url });
      } catch (error) {
        console.error("Stripe Error:", error);
        res.status(500).send({ message: "Failed to create checkout session" });
      }
    });

    app.post("/api/payment-success", async (req, res) => {
      try {
        const { sessionId } = req.body;
        if (!sessionId)
          return res
            .status(400)
            .send({ success: false, message: "Missing sessionId" });

        const session = await stripe.checkout.sessions.retrieve(sessionId);

        if (session.payment_status === "paid") {
          const email = session.customer_details?.email;
          if (!email)
            return res
              .status(400)
              .send({ success: false, message: "Email not found" });

          const updateResult = await usersCollection.updateOne(
            { email },
            { $set: { isPremium: true, role: "premium" } },
          );

          if (updateResult.modifiedCount > 0 || updateResult.matchedCount > 0) {
            return res.send({ success: true, isPremium: true });
          }
          return res
            .status(404)
            .send({ success: false, message: "User email mismatch" });
        }
        res
          .status(400)
          .send({ success: false, message: "Payment not completed" });
      } catch (error) {
        res
          .status(500)
          .send({ success: false, message: "Failed to update premium status" });
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
