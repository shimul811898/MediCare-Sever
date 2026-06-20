const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

const uri = process.env.MONGODB_URI;

const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
});

let db;

async function connectDB() {
    try {
        await client.connect();
        db = client.db("medicare");
        console.log("Successfully connected to MongoDB!");
        const adminEmail = "shimul811898@gmail.com";
        const userCol = db.collection("user");
        const adminUser = await userCol.findOne({ email: adminEmail });
        if (adminUser && adminUser.role !== "admin") {
            await userCol.updateOne(
                { email: adminEmail },
                { $set: { role: "admin" } }
            );
            console.log(`Successfully upgraded ${adminEmail} to admin role.`);
        }
    } catch (error) {
        console.error("MongoDB connection failed:", error);
        process.exit(1);
    }
}

connectDB();

app.get("/", (req, res) => {
    res.send("MediCare Server is running fine!");
});


app.post("/api/doctors/profile", async (req, res) => {
    const { userId, specialization, hospital, fee, bio, schedules } = req.body;

    if (!userId) {
        return res.status(400).json({ error: "userId is required" });
    }

    const doctorProfile = {
        userId,
        specialization: specialization || "",
        hospital: hospital || "",
        fee: Number(fee) || 0,
        bio: bio || "",
        schedules: schedules || [],
        updatedAt: new Date(),
    };


    const result = await db.collection("doctors").updateOne(
        { userId },
        { $set: doctorProfile },
        { upsert: true }
    );

    res.json(result);

});


app.get("/api/doctors/:userId", async (req, res) => {
    const { userId } = req.params;
    const doctor = await db.collection("doctors").findOne({ userId });

    const user = await db.collection("user").findOne({
        $or: [
            { _id: userId },
            { id: userId }
        ]
    });

    if (!doctor) {
        return res.status(404).json({ error: "Doctor profile not found" });
    }

    res.json({
        ...doctor,
        name: user?.name || "Doctor",
        email: user?.email || "",
        image: user?.image || "",
    });
});



app.post("/api/appointments", async (req, res) => {

    const {
        patientId,
        patientName,
        patientEmail,
        doctorId,
        doctorName,
        doctorSpecialization,
        date,
        timeSlot,
        fee,
    } = req.body;

    if (!patientId || !doctorId || !date || !timeSlot) {
        return res.status(400).json({ error: "Missing required booking details" });
    }

    const appointment = {
        patientId,
        patientName,
        patientEmail,
        doctorId,
        doctorName,
        doctorSpecialization,
        date,
        timeSlot,
        fee: Number(fee) || 0,
        status: "pending",
        paymentStatus: "unpaid",
        createdAt: new Date(),
    };

    const result = await db.collection("appointments").insertOne(appointment);
    res.status(201).json({ message: "Appointment booked successfully", appointmentId: result.insertedId });
});

app.get("/api/appointments/patient/:patientId", async (req, res) => {
        const { patientId } = req.params;
        const appointments = await db.collection("appointments")
            .find({ patientId })
            .sort({ createdAt: -1 })
            .toArray();
        res.json(appointments);
});


app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});