const express = require("express");
const cors = require("cors");
const app = express();
require("dotenv").config();
const jwt = require("jsonwebtoken");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const stripe = require("stripe")(process.env.STRIPE_SK);
const port = process.env.PORT || 5000;

//Middleware
app.use(cors());
app.use(express.json());

const uri = process.env.DB_URL;
const client = new MongoClient(uri, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
  serverApi: ServerApiVersion.v1,
});

const verifyJwt = (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    return res.status(401).send("Unauthorized access");
  }

  const token = authHeader.split(" ")[1];
  jwt.verify(token, process.env.ACCESS_TOKEN, function (err, decoded) {
    if (err) {
      return res.status(403).send({ message: "forbidden access" });
    }
    req.decoded = decoded;
    next();
  });
};

async function run() {
  try {
    client.connect();
    const usersCollection = client.db("laptopStore").collection("users");
    const categoriesCollection = client
      .db("laptopStore")
      .collection("categories");
    const productsCollection = client.db("laptopStore").collection("products");
    const bookingsCollection = client.db("laptopStore").collection("bookings");
    const paymentsCollection = client.db("laptopStore").collection("payments");

    const verifyAdmin = async (req, res, next) => {
      const decodedEmail = req.decoded.email;

      const query = { email: decodedEmail };
      const user = await usersCollection.findOne(query);

      if (user.role !== "admin") {
        return res.status(403).send({ message: "forbidden access" });
      }
      next();
    };
    const verifySeller = async (req, res, next) => {
      const decodedEmail = req.decoded.email;

      const query = { email: decodedEmail };
      const user = await usersCollection.findOne(query);

      if (user.role !== "seller") {
        return res.status(403).send({ message: "forbidden access" });
      }
      next();
    };

    //Jwt
    app.get("/jwt", async (req, res) => {
      const email = req.query.email;

      const query = { email: email };
      const user = await usersCollection.findOne(query);
      if (user) {
        const token = jwt.sign({ email }, process.env.ACCESS_TOKEN, {
          expiresIn: "1d",
        });
        return res.send({ accessToken: token });
      }

      res.status(403).send({ accessToken: "" });
    });

    app.post("/create-payment-intent", async (req, res) => {
      const booking = req.body;
      const price = booking.price;
      const amount = price * 100;

      const paymentIntent = await stripe.paymentIntents.create({
        currency: "usd",
        amount: amount,
        payment_method_types: ["card"],
      });
      res.send({
        clientSecret: paymentIntent.client_secret,
      });
    });

    app.post("/payments", async (req, res) => {
      const payment = req.body;
      const result = await paymentsCollection.insertOne(payment);
      const id = payment.bookingId;
      const filter = { _id: ObjectId(id) };
      const updatedDoc = {
        $set: {
          paid: true,
          transactionId: payment.transactionId,
        },
      };
      const updateResult = await bookingsCollection.updateOne(
        filter,
        updatedDoc
      );

      const productId = payment.productId;
      const productFilter = { _id: ObjectId(productId) };

      const updatedProduct = {
        $set: {
          sold: true,
          advertise: false,
        },
      };
      const updateProductResult = await productsCollection.updateOne(
        productFilter,
        updatedProduct
      );

      res.send(result);
    });

    // users

    app.get("/users", verifyJwt, verifyAdmin, async (req, res) => {
      const role = req.query.role;
      let query = {};

      if (role === "seller") {
        query = { role: role };
      }
      if (role === "buyer") {
        query = { role: role };
      }

      const user = await usersCollection.find(query).toArray();
      res.send(user);
    });

    app.get("/users/:email", async (req, res) => {
      const email = req.params.email;
      const query = { email: email };
      const user = await usersCollection.findOne(query);
      res.send(user);
    });

    app.get("/users/admin/:email", async (req, res) => {
      const email = req.params.email;
      const query = { email: email };
      const user = await usersCollection.findOne(query);
      res.send({ isAdmin: user?.role === "admin" });
    });

    app.get("/users/seller/:email", async (req, res) => {
      const email = req.params.email;
      const query = { email: email };
      const user = await usersCollection.findOne(query);
      res.send({ isSeller: user?.role === "seller" });
    });

    app.get("/users/buyer/:email", async (req, res) => {
      const email = req.params.email;
      const query = { email: email };
      const user = await usersCollection.findOne(query);
      res.send({ isBuyer: user?.role === "buyer" });
    });

    app.post("/users", async (req, res) => {
      const user = req.body;
      const query = { email: user.email };
      const users = await usersCollection.findOne(query);

      if (users?.email === user?.email) {
        return;
      }

      const result = await usersCollection.insertOne(user);
      res.send(result);
    });

    app.put("/users", async (req, res) => {
      const email = req.query.email;
      const filter = { email: email };
      const options = { upsert: true };
      const updatedDoc = {
        $set: {
          status: "verified",
        },
      };
      const result = await usersCollection.updateOne(
        filter,
        updatedDoc,
        options
      );

      res.send(result);
    });

    app.delete("/users/:id", async (req, res) => {
      const id = req.params.id;
      const filter = { _id: ObjectId(id) };
      const result = await usersCollection.deleteOne(filter);
      res.send(result);
    });

    app.get("/jwt", async (req, res) => {
      const email = req.query.email;

      const query = { email: email };
      const user = await usersCollection.findOne(query);
      if (user) {
        const token = jwt.sign({ email }, process.env.ACCESS_TOKEN, {
          expiresIn: "1h",
        });
        return res.send({ accessToken: token });
      }

      res.status(403).send({ accessToken: "" });
    });

    // categories
    app.get("/categories", async (req, res) => {
      const query = {};
      const categories = await categoriesCollection.find(query).toArray();
      res.send(categories);
    });

    //Bookings

    app.get("/bookings", verifyJwt, async (req, res) => {
      const email = req.query.email;
      const decodedEmail = req.decoded.email;

      if (email !== decodedEmail) {
        return res.status(403).send({ message: "forbidden access" });
      }

      const query = { email: email };
      const bookings = await bookingsCollection.find(query).toArray();
      res.send(bookings);
    });

    app.get("/bookings/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: ObjectId(id) };
      const booking = await bookingsCollection.findOne(query);
      res.send(booking);
    });

    app.post("/bookings", async (req, res) => {
      const booking = req.body;

      const query = { email: booking.email, productId: booking.productId };
      const alreadyBooked = await bookingsCollection.find(query).toArray();

      if (alreadyBooked.length) {
        const message = `You have already booking ${booking.productName}`;
        return res.send({ acknowledged: false, message });
      }

      const result = await bookingsCollection.insertOne(booking);
      res.send(result);
    });

    //Products
    app.get("/products", async (req, res) => {
      const email = req.query.email;
      const query = { email: email };

      const products = await productsCollection.find(query).toArray();

      res.send(products);
    });

    app.get("/products/categories/:id", async (req, res) => {
      const id = req.params.id;
      const query = { categoryId: id };
      const products = await productsCollection.find(query).toArray();

      products.forEach(async (p) => {
        const sellerEmail = p?.email;

        const userQuery = { email: sellerEmail };
        const user = await usersCollection.findOne(userQuery);

        if (user?.status === "verified") {
          const filter = { email: user?.email };
          const options = { upsert: true };
          const updatedDoc = {
            $set: {
              sellerStatus: "verified",
            },
          };
          const result = await productsCollection.updateMany(
            filter,
            updatedDoc,
            options
          );
        }
      });

      const remaining = products.filter((p) => !p.sold);

      res.send(remaining);
    });

    app.post("/products", verifyJwt, verifySeller, async (req, res) => {
      const product = req.body;
      const result = await productsCollection.insertOne(product);
      res.send(result);
    });

    app.put("/products", async (req, res) => {
      const id = req.query.id;
      const filter = { _id: ObjectId(id) };
      const options = { upsert: true };
      const updatedDoc = {
        $set: {
          advertise: true,
        },
      };

      const result = await productsCollection.updateOne(
        filter,
        updatedDoc,
        options
      );
      res.send(result);
    });

    app.delete("/products/:id", async (req, res) => {
      const id = req.params.id;

      const filter = { _id: ObjectId(id) };
      const result = await productsCollection.deleteOne(filter);
      res.send(result);
    });

    app.get("/products/advertise", verifyJwt, async (req, res) => {
      const query = { advertise: true };
      const products = await productsCollection.find(query).toArray();
      res.send(products);
    });

    app.get("/products/report", async (req, res) => {
      const reported = req.query.reported;
      const query = { reported: true };
      const reportedProducts = await productsCollection.find(query).toArray();
      res.send(reportedProducts);
    });

    app.put("/products/report/:id", async (req, res) => {
      const id = req.params.id;

      const filter = { _id: ObjectId(id) };
      const options = { upsert: true };
      const updatedDoc = {
        $set: {
          reported: true,
        },
      };

      const result = await productsCollection.updateOne(
        filter,
        updatedDoc,
        options
      );
      res.send(result);
    });
  } finally {
  }
}
run().catch((err) => console.log(err.message));

app.get("/", async (req, res) => {
  res.send("Server is running");
});

app.listen(port, () => {
  console.log(`Server is running on ${port}`);
});
