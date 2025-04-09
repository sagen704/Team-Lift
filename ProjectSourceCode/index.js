// run "npm install express to your local repo"
// *****************************************************
// <!-- Section 1 : Import Dependencies -->
// *****************************************************

const express = require("express"); // To build an application server or API
const app = express();
const handlebars = require("express-handlebars");
const Handlebars = require("handlebars");
const path = require("path");
const pgp = require("pg-promise")(); // To connect to the Postgres DB from the node server
const bodyParser = require("body-parser");
const session = require("express-session"); // To set the session object. To store or access session data, use the `req.session`, which is (generally) serialized as JSON by the store.
const bcrypt = require("bcryptjs"); //  To hash passwords
const req = require("express/lib/request");
const axios = require("axios").default;

// *****************************************************
// <!-- Section 2 : Connect to DB -->
// *****************************************************

// create `ExpressHandlebars` instance and configure the layouts and partials dir.
const hbs = handlebars.create({
  extname: "hbs",
  layoutsDir: __dirname + "/views/layouts",
  partialsDir: __dirname + "/views/partials",
});

// database configuration
const dbConfig = {
  host: "db", // the database server
  port: 5432, // the database port
  database: process.env.POSTGRES_DB, // the database name
  user: process.env.POSTGRES_USER, // the user account to connect with
  password: process.env.POSTGRES_PASSWORD, // the password of the user account
};

const db = pgp(dbConfig);

// test your database
db.connect()
  .then((obj) => {
    console.log("Database connection successful"); // you can view this message in the docker compose logs
    obj.done(); // success, release the connection;
  })
  .catch((error) => {
    console.log("ERROR:", error.message || error);
  });

// *****************************************************
// <!-- Section 3 : App Settings -->
// *****************************************************

// Register `hbs` as our view engine using its bound `engine()` function.
app.engine("hbs", hbs.engine);
app.set("view engine", "hbs");
app.set("views", path.join(__dirname, "views"));
app.use(bodyParser.json()); // specify the usage of JSON for parsing request body.

// initialize session variables
app.use(
  session({
    secret: process.env.SESSION_SECRET,
    saveUninitialized: false,
    resave: false,
  })
);
app.use((req, res, next) => {
  res.locals.user = req.session.user;
  next();
});
app.use(
  bodyParser.urlencoded({
    extended: true,
  })
);

app.use("/images", express.static(path.join(__dirname, "images")));

app.get("/tracking", (req, res) => {
  res.render("pages/tracking");
  //do something
});

// *****************************************************
// <!-- Section 4 : API Routes -->
// *****************************************************

// TODO - Include your API routes here
//Register
app.get("/register", (req, res) => {
  res.render("pages/register.hbs");
});

app.get("/welcome", (req, res) => {
  res.json({ status: "success", message: "Welcome!" });
});

app.post("/register", async (req, res) => {
  let password = req.body.password;
  let confirmPassword = req.body.confirmPassword;
  let username = req.body.username;
  let email = req.body.email;
  let birthday = req.body.birthday;

  //checks that password and confirm password are the same
  if (password !== confirmPassword) {
    return res.render("pages/register", {
      error: true,
      message: "Passwords do not match",
      username: username,
      email: email,
      birthday: birthday,
    });
  }

  const hash = await bcrypt.hash(req.body.password, 10);

  try {
    //adds data into user database then redirects user to login page
    await db.none(
      `
      INSERT INTO users (username, hash_password, email, birthday) VALUES ($1, $2, $3, $4);`,
      [username, hash, email, birthday]
    );
    res.status(201).redirect("/login");
  } catch (err) {
    if (err.code == "23505") {
      res.render("pages/register", {
        error: true,
        message: "Username already exists",
      });
    } else {
      console.error("error", err);
      res.redirect("/register");
    }
  }
});

//login
app.get("/login", (req, res) => {
  res.render("pages/login.hbs");
});

app.get("/exercises", async (req, res) => {
  const options = {
    method: "GET",
    url: "https://exercisedb.p.rapidapi.com/exercises?limit=10",
    headers: {
      "X-RapidAPI-Key": process.env.EX_API_KEY,
      "x-rapidapi-host": "exercisedb.p.rapidapi.com",
    },
  };

  try {
    const { data } = await axios.request(options);
    // console.log(data);
    const exerciseNames = data.map((exercise) => exercise.name);

    // console.log(exerciseNames);

    const testerName = "abs workout tutorial";

    const vid_data = [];

    const getVideoId = async (exerciseName) => {
      const ytOptions = {
        method: "GET",
        url: "https://www.googleapis.com/youtube/v3/search",
        params: {
          part: "snippet",
          maxResults: 1,
          type: "video",
          q: exerciseName,
          key: process.env.YT_API_KEY,
        },
      };

      try {
        const response = await axios.request(ytOptions);
        const videoData = response.data;
        if (videoData.items && videoData.items.length > 0) {
          const video = videoData.items[0];
          const videoId = video.id.videoId;
          return videoId;
        } else {
          console.log("No videos found");
          return null;
        }
      } catch (error) {
        console.log(error);
        return null;
      }
    };

    const videoLinks = async () => {
      for (let exercise of exerciseNames) {
        const input = exercise + " workout tutorial";
        const videoId = await getVideoId(input);
        vid_data.push({
          videoId: "https://www.youtube.com/embed/" + videoId,
        });
      }
      // console.log(vid_data);
      return vid_data;
    };

    const videoLinkData = await videoLinks();
    // console.log(videoLinkData);
    const mergedExercises = data.map((exercise, index) => ({
      ...exercise,
      videoId: videoLinkData[index]?.videoId || null, // adds videoId to each object
    }));
    console.log(mergedExercises);

    res.render("pages/exercises.hbs", { mergedExercises });
  } catch (error) {
    console.error(error);
    res.status(500).render("pages/exercises.hbs", {
      exercises: [],
    });
  }
});

app.get("/", (req, res) => {
  res.redirect("/login");
});

app.post("/login", async (req, res) => {
  let username = req.body.username;

  try {
    const user = await db.one(`SELECT * FROM users WHERE username= $1;`, [
      username,
    ]);

    // check if password from request matches with password in DB
    const match = await bcrypt.compare(req.body.password, user.hash_password);

    res.status(200);

    if (match) {
      req.session.user = user;
      req.session.save();

      res.redirect("/home");
    } else {
      res.render("pages/login", {
        message: `Incorrect password`,
        error: true,
      });
    }
  } catch (err) {
    res.status(401);
    res.redirect("/register");
  }
});

const auth = (req, res, next) => {
  if (!req.session.user) {
    // Default to login page.
    return res.redirect("/login");
  }
  next();
};

app.use(auth);

app.get("/home", async (req, res) => {
  const today = new Date().toLocaleDateString(); // Get current date
  res.render("pages/home", { date: today });
});

// *****************************************************
// <!-- Section 5 : Start Server-->
// *****************************************************
// starting the server and keeping the connection open to listen for more requests

module.exports = app.listen(3000);
console.log("Server is listening on port 3000");
