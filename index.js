const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");

dotenv.config();

const app = express();

app.use(cors({
    origin: "*",
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"]
}));
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
let isConnected = false;

async function connectDB() {
    if (isConnected && db) return db;
    try {
        await client.connect();
        db = client.db("medicare");
        isConnected = true;
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
        throw error;
    }
    return db;
}

connectDB().catch(console.error);


app.use(async (req, res, next) => {
    try {
        await connectDB();
        next();
    } catch (err) {
        res.status(500).json({ error: "Database connection failed" });
    }
});

app.get("/", (req, res) => {
    res.send("MediCare Server is running fine!");
});


app.get("/api/users", async (req, res) => {
    try {
        const users = await db.collection("user").find({}).toArray();
        res.json(users);
    } catch (err) {
        res.status(500).json({ error: "Failed to load users: " + err.message });
    }
});

app.patch("/api/users/:id/role", async (req, res) => {
    try {
        const { id } = req.params;
        const { role } = req.body;

        if (!["patient", "doctor", "admin"].includes(role)) {
            return res.status(400).json({ error: "Invalid role" });
        }

        // ফ্রন্টএন্ড ডেটার সাথে ম্যাচ করার জন্য ObjectId এবং String ID দুটির জন্যই কুয়েরি রেডি করা
        const queryOrConditions = [{ id: id }];
        if (typeof id === "string" && id.length === 24 && ObjectId.isValid(id)) {
            queryOrConditions.push({ _id: new ObjectId(id) });
        }
        const query = { $or: queryOrConditions };

        const result = await db.collection("user").updateOne(query, { $set: { role } });

        if (role === "doctor") {
            const exists = await db.collection("doctors").findOne({ userId: id });
            if (!exists) {
                await db.collection("doctors").insertOne({
                    userId: id, specialization: "", hospital: "", fee: 0, bio: "",
                    schedules: [], verified: false, createdAt: new Date(),
                });
            }
        }
        res.json({ message: `User role updated to ${role}`, result });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete("/api/users/:id", async (req, res) => {
    try {
        const { id } = req.params;
        
        const queryOrConditions = [{ id: id }];
        if (typeof id === "string" && id.length === 24 && ObjectId.isValid(id)) {
            queryOrConditions.push({ _id: new ObjectId(id) });
        }

        const result = await db.collection("user").deleteOne({ $or: queryOrConditions });
        await db.collection("doctors").deleteOne({ userId: id });
        await db.collection("appointments").deleteMany({ $or: [{ patientId: id }, { doctorId: id }] });

        res.json(result);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});


app.get("/api/doctors-all/admin", async (req, res) => {
    try {
        const doctorsList = await db.collection("doctors").find({}).toArray();
        const enrichedDoctors = [];

        for (const doc of doctorsList) {
            if (!doc.userId) continue; 

            const userQuery = { $or: [{ id: doc.userId }] };
            if (typeof doc.userId === "string" && doc.userId.length === 24 && ObjectId.isValid(doc.userId)) {
                userQuery.$or.push({ _id: new ObjectId(doc.userId) });
            }

            const user = await db.collection("user").findOne(userQuery);

            enrichedDoctors.push({
                ...doc,
                name: doc.name || user?.name || "Unknown Doctor",
                email: user?.email || "No Email",
                image: doc.image || user?.image || "",
            });
        }
        res.json(enrichedDoctors);
    } catch (err) {
        res.status(500).json({ error: "Failed to load admin doctors list: " + err.message });
    }
});

app.patch("/api/doctors/:id/verify", async (req, res) => {
    try {
        const { id } = req.params;
        const { verified } = req.body;

        const query = {
            $or: [
                { userId: id },
                { id: id }
            ]
        };
        
        if (typeof id === "string" && id.length === 24 && ObjectId.isValid(id)) {
            query.$or.push({ _id: new ObjectId(id) });
        }

        const result = await db.collection("doctors").updateOne(
            query,
            { $set: { verified: !!verified } }
        );
        res.json(result);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});



app.get("/api/payments", async (req, res) => {
    try {
        const payments = await db.collection("payments").find({}).sort({ paymentDate: -1 }).toArray();
        res.json(payments);
    } catch (err) {
        res.status(500).json({ error: "Failed to load payments history: " + err.message });
    }
});



app.get("/api/admin/stats", async (req, res) => {
    try {
        const totalUsers = await db.collection("user").countDocuments() || 0;
        const totalPatients = await db.collection("user").countDocuments({
            $or: [{ role: "patient" }, { role: { $exists: false } }, { role: null }]
        }) || 0;

        const totalDoctors = await db.collection("user").countDocuments({ role: "doctor" }) || 0;
        const verifiedDoctors = await db.collection("doctors").countDocuments({ verified: true }) || 0;
        const totalAppointments = await db.collection("appointments").countDocuments() || 0;
        const totalReviews = await db.collection("reviews").countDocuments() || 0;

        const paidAppointments = await db.collection("appointments").find({ paymentStatus: "paid" }).toArray() || [];
        const totalRevenue = paidAppointments.reduce((sum, appt) => sum + (Number(appt.fee) || 0), 0);

        const recentAppointments = await db.collection("appointments").find({}).sort({ createdAt: -1 }).limit(5).toArray() || [];

        res.json({
            totalUsers, totalPatients, totalDoctors, verifiedDoctors,
            totalAppointments, totalReviews, totalRevenue, recentAppointments
        });
    } catch (err) {
        res.status(500).json({ error: "Analytics failed to calculate: " + err.message });
    }
});


app.post("/api/doctors/profile", async (req, res) => {
    try {
        const { userId, name, image, specialization, hospital, fee, bio, schedules } = req.body;
        if (!userId) return res.status(400).json({ error: "userId is required" });

        const updateFields = { updatedAt: new Date() };
        if (name !== undefined) updateFields.name = name;
        if (image !== undefined) updateFields.image = image;
        if (specialization !== undefined) updateFields.specialization = specialization;
        if (hospital !== undefined) updateFields.hospital = hospital;
        if (fee !== undefined && fee !== null && fee !== "") {
            const parsedFee = Number(fee);
            if (!isNaN(parsedFee) && parsedFee >= 0) updateFields.fee = parsedFee;
        }
        if (bio !== undefined) updateFields.bio = bio;
        if (schedules !== undefined) updateFields.schedules = schedules;

        const result = await db.collection("doctors").updateOne({ userId }, { $set: updateFields }, { upsert: true });
        res.json(result);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get("/api/doctors/:userId", async (req, res) => {
    try {
        const { userId } = req.params;
        const doctor = await db.collection("doctors").findOne({ userId });

        const userQuery = { $or: [{ id: userId }] };
        if (typeof userId === "string" && userId.length === 24 && ObjectId.isValid(userId)) {
            userQuery.$or.push({ _id: new ObjectId(userId) });
        }

        const user = await db.collection("user").findOne(userQuery);
        if (!doctor) return res.status(404).json({ error: "Doctor profile not found" });

        res.json({
            ...doctor,
            name: doctor.name || user?.name || "Doctor",
            email: user?.email || "",
            image: doctor.image || user?.image || "",
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get("/api/doctors", async (req, res) => {
    try {
        const { search, specialization } = req.query;
        const query = {};
        if (specialization) query.specialization = { $regex: new RegExp(specialization, "i") };

        const doctorsList = await db.collection("doctors").find(query).toArray();
        const enrichedDoctors = [];

        for (const doc of doctorsList) {
            const userQuery = { $or: [{ id: doc.userId }] };
            if (typeof doc.userId === "string" && doc.userId.length === 24 && ObjectId.isValid(doc.userId)) {
                userQuery.$or.push({ _id: new ObjectId(doc.userId) });
            }

            const user = await db.collection("user").findOne(userQuery);

            if (doc.verified) {
                const matchesSearch = !search ||
                    (user?.name && user.name.toLowerCase().includes(search.toLowerCase())) ||
                    (doc.specialization && doc.specialization.toLowerCase().includes(search.toLowerCase())) ||
                    (doc.hospital && doc.hospital.toLowerCase().includes(search.toLowerCase()));

                if (matchesSearch) {
                    enrichedDoctors.push({
                        ...doc,
                        name: doc.name || user?.name || "Doctor",
                        email: user?.email || "",
                        image: doc.image || user?.image || "",
                    });
                }
            }
        }
        res.json(enrichedDoctors);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post("/api/appointments", async (req, res) => {
    try {
        const { patientId, patientName, patientEmail, doctorId, doctorName, doctorSpecialization, date, timeSlot, fee, symptoms } = req.body;
        if (!patientId || !doctorId || !date || !timeSlot) return res.status(400).json({ error: "Missing required booking details" });

        const appointment = {
            patientId, patientName, patientEmail, doctorId, doctorName, doctorSpecialization, date, timeSlot,
            fee: Number(fee) || 0, status: "pending", paymentStatus: "unpaid", symptoms: symptoms || "", createdAt: new Date(),
        };

        const result = await db.collection("appointments").insertOne(appointment);
        res.status(201).json({ message: "Appointment booked successfully", appointmentId: result.insertedId });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get("/api/appointments/patient/:patientId", async (req, res) => {
    try {
        const appointments = await db.collection("appointments").find({ patientId: req.params.patientId }).sort({ createdAt: -1 }).toArray();
        res.json(appointments);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get("/api/appointments/doctor/:doctorId", async (req, res) => {
    try {
        const appointments = await db.collection("appointments").find({ doctorId: req.params.doctorId }).sort({ createdAt: -1 }).toArray();
        res.json(appointments);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get("/api/appointments", async (req, res) => {
    try {
        const appointments = await db.collection("appointments").find({}).sort({ createdAt: -1 }).toArray();
        res.json(appointments);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get("/api/appointments/:id", async (req, res) => {
    try {
        const { id } = req.params;
        const queryOrConditions = [{ id: id }];
        if (typeof id === "string" && id.length === 24 && ObjectId.isValid(id)) {
            queryOrConditions.push({ _id: new ObjectId(id) });
        }

        const appointment = await db.collection("appointments").findOne({ $or: queryOrConditions });
        if (!appointment) return res.status(404).json({ error: "Appointment not found" });
        res.json(appointment);
    } catch (err) {
        res.status(500).json({ error: "Internal server error" });
    }
});

app.patch("/api/appointments/:id/status", async (req, res) => {
    try {
        const { id } = req.params;
        const { status } = req.body;
        if (!["pending", "approved", "rejected", "completed"].includes(status)) return res.status(400).json({ error: "Invalid status" });

        const queryOrConditions = [{ id: id }];
        if (typeof id === "string" && id.length === 24 && ObjectId.isValid(id)) {
            queryOrConditions.push({ _id: new ObjectId(id) });
        }

        const result = await db.collection("appointments").updateOne({ $or: queryOrConditions }, { $set: { status } });
        res.json(result);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.patch("/api/appointments/:id/prescription", async (req, res) => {
    try {
        const { id } = req.params;
        const { prescription } = req.body;
        if (!prescription) return res.status(400).json({ error: "Prescription text is required" });

        const queryOrConditions = [{ id: id }];
        if (typeof id === "string" && id.length === 24 && ObjectId.isValid(id)) {
            queryOrConditions.push({ _id: new ObjectId(id) });
        }

        const result = await db.collection("appointments").updateOne({ $or: queryOrConditions }, { $set: { prescription, prescribedAt: new Date() } });
        res.json(result);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.patch("/api/appointments/:id/pay", async (req, res) => {
    try {
        const { id } = req.params;
        const { transactionId } = req.body;
        const txnId = transactionId || `TXN-${Date.now()}`;
        
        const queryOrConditions = [{ id: id }];
        if (typeof id === "string" && id.length === 24 && ObjectId.isValid(id)) {
            queryOrConditions.push({ _id: new ObjectId(id) });
        }
        const query = { $or: queryOrConditions };

        const result = await db.collection("appointments").updateOne(query, {
            $set: { paymentStatus: "paid", transactionId: txnId, paidAt: new Date() }
        });

        const appointment = await db.collection("appointments").findOne(query);
        if (appointment) {
            await db.collection("payments").insertOne({
                appointmentId: id,
                patientId: appointment.patientId,
                doctorId: appointment.doctorId,
                amount: appointment.fee || 0,
                transactionId: txnId,
                paymentDate: new Date()
            });
        }
        res.json(result);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post("/api/reviews", async (req, res) => {
    try {
        const { appointmentId, doctorId, patientId, patientName, patientImage, rating, comment } = req.body;
        if (!doctorId || !patientId || !rating) return res.status(400).json({ error: "Missing required review fields" });

        const existingReview = await db.collection("reviews").findOne({ appointmentId });

        if (existingReview) {
            await db.collection("reviews").updateOne(
                { appointmentId },
                { $set: { rating: Number(rating), comment: comment || "", updatedAt: new Date() } }
            );
        } else {
            const review = {
                appointmentId, doctorId, patientId, patientName: patientName || "Anonymous",
                patientImage: patientImage || "", rating: Number(rating), comment: comment || "", createdAt: new Date(),
            };
            await db.collection("reviews").insertOne(review);
        }

        const reviews = await db.collection("reviews").find({ doctorId }).toArray();
        const averageRating = reviews.length > 0 ? reviews.reduce((acc, curr) => acc + curr.rating, 0) / reviews.length : 0;

        await db.collection("doctors").updateOne(
            { userId: doctorId },
            { $set: { averageRating: parseFloat(averageRating.toFixed(1)), reviewCount: reviews.length } }
        );
        res.status(201).json({ message: "Review saved successfully" });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get("/api/reviews", async (req, res) => {
    try {
        const reviews = await db.collection("reviews").find({}).sort({ rating: -1, createdAt: -1 }).limit(3).toArray();
        const enrichedReviews = [];
        const userIds = [...new Set(reviews.map(r => r.patientId))];
        const users = await db.collection("user").find({ id: { $in: userIds } }).toArray();
        const userMap = new Map(users.map(u => [u.id, u.image]));

        for (const rev of reviews) {
            let doctorName = "Doctor";
            if (rev.doctorId) {
                const doctor = await db.collection("doctors").findOne({ userId: rev.doctorId });
                if (doctor) doctorName = doctor.name || "Doctor";
                if (doctorName === "Doctor") {
                    const userQuery = { $or: [{ id: rev.doctorId }] };
                    if (typeof rev.doctorId === "string" && rev.doctorId.length === 24 && ObjectId.isValid(rev.doctorId)) {
                        userQuery.$or.push({ _id: new ObjectId(rev.doctorId) });
                    }
                    const user = await db.collection("user").findOne(userQuery);
                    if (user) doctorName = user.name || "Doctor";
                }
            }
            enrichedReviews.push({ ...rev, doctorName, patientImage: rev.patientImage || userMap.get(rev.patientId) || "" });
        }
        res.json(enrichedReviews);
    } catch (err) {
        res.status(500).json({ error: "Failed to fetch reviews" });
    }
});

app.get("/api/reviews/patient/:patientId", async (req, res) => {
    try {
        const reviews = await db.collection("reviews").find({ patientId: req.params.patientId }).toArray();
        res.json(reviews);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get("/api/reviews/:doctorId", async (req, res) => {
    try {
        const reviews = await db.collection("reviews").find({ doctorId: req.params.doctorId }).sort({ createdAt: -1 }).toArray();
        res.json(reviews);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete("/api/appointments/:id", async (req, res) => {
    try {
        const { id } = req.params;
        const queryOrConditions = [{ id: id }];
        if (typeof id === "string" && id.length === 24 && ObjectId.isValid(id)) {
            queryOrConditions.push({ _id: new ObjectId(id) });
        }

        const result = await db.collection("appointments").deleteOne({ $or: queryOrConditions });
        res.json(result);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

if (process.env.NODE_ENV !== "production") {
    const PORT = process.env.PORT || 5000;
    app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
}

module.exports = app;