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
    const { userId, name, image, specialization, hospital, fee, bio, schedules } = req.body;

    if (!userId) {
        return res.status(400).json({ error: "userId is required" });
    }

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

    const result = await db.collection("doctors").updateOne(
        { userId },
        { $set: updateFields },
        { upsert: true }
    );

    res.json(result);
});


app.get("/api/doctors/:userId", async (req, res) => {
    const { userId } = req.params;
    const doctor = await db.collection("doctors").findOne({ userId });

    const userQuery = {
        $or: [
            { _id: userId },
            { id: userId }
        ]
    };
    if (ObjectId.isValid(userId)) {
        userQuery.$or.push({ _id: new ObjectId(userId) });
    }

    const user = await db.collection("user").findOne(userQuery);

    if (!doctor) {
        return res.status(404).json({ error: "Doctor profile not found" });
    }

    res.json({
        ...doctor,
        name: doctor.name || user?.name || "Doctor",
        email: user?.email || "",
        image: doctor.image || user?.image || "",
    });
});

app.get("/api/doctors", async (req, res) => {
    const { search, specialization } = req.query;

    const query = {};
    if (specialization) {
        query.specialization = { $regex: new RegExp(specialization, "i") };
    }

    const doctorsList = await db.collection("doctors").find(query).toArray();

    const enrichedDoctors = [];

    for (const doc of doctorsList) {
        const userQuery = {
            $or: [
                { _id: doc.userId },
                { id: doc.userId }
            ]
        };
        if (ObjectId.isValid(doc.userId)) {
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

});

app.get("/api/doctors-all/admin", async (req, res) => {
    const doctorsList = await db.collection("doctors").find({}).toArray();
    const enrichedDoctors = [];

    for (const doc of doctorsList) {
        const userQuery = {
            $or: [
                { _id: doc.userId },
                { id: doc.userId }
            ]
        };
        if (ObjectId.isValid(doc.userId)) {
            userQuery.$or.push({ _id: new ObjectId(doc.userId) });
        }

        const user = await db.collection(
            "user"
        ).findOne(userQuery);

        enrichedDoctors.push({
            ...doc,
            name: doc.name || user?.name || "Doctor",
            email: user?.email || "",
            image: doc.image || user?.image || "",
        });
    }

    res.json(enrichedDoctors);
});

app.patch("/api/doctors/:id/verify", async (req, res) => {
    const { id } = req.params;
    const { verified } = req.body;

    const result = await db.collection("doctors").updateOne(
        { _id: new ObjectId(id) },
        { $set: { verified: !!verified } }
    );

    res.json(result);
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
        symptoms,
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
        symptoms: symptoms || "",
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

app.get("/api/appointments/doctor/:doctorId", async (req, res) => {
        const { doctorId } = req.params;
        const appointments = await db.collection("appointments")
            .find({ doctorId })
            .sort({ createdAt: -1 })
            .toArray();
        res.json(appointments);
});

app.get("/api/appointments", async (req, res) => {
   
        const appointments = await db.collection("appointments")
            .find({})
            .sort({ createdAt: -1 })
            .toArray();
        res.json(appointments);
});

app.get("/api/appointments/:id", async (req, res) => {
    try {
        const { id } = req.params;
        const appointment = await db.collection("appointments").findOne({ _id: new ObjectId(id) });
        if (!appointment) {
            return res.status(404).json({ error: "Appointment not found" });
        }
        res.json(appointment);
    } catch (err) {
        res.status(500).json({ error: "Internal server error" });
    }
});


app.patch("/api/appointments/:id/status", async (req, res) => {
        const { id } = req.params;
        const { status } = req.body;

        if (!["pending", "approved", "rejected", "completed"].includes(status)) {
            return res.status(400).json({ error: "Invalid status value" });
        }

        const result = await db.collection("appointments").updateOne(
            { _id: new ObjectId(id) },
            { $set: { status } }
        );

        res.json( result );
    
});

app.patch("/api/appointments/:id/prescription", async (req, res) => {
    const { id } = req.params;
    const { prescription } = req.body;

    if (!prescription) {
        return res.status(400).json({ error: "Prescription text is required" });
    }

    const result = await db.collection("appointments").updateOne(
        { _id: new ObjectId(id) },
        { $set: { prescription, prescribedAt: new Date() } }
    );

    res.json(result);
});




app.patch("/api/appointments/:id/pay", async (req, res) => {
        const { id } = req.params;
        const { transactionId } = req.body;

        const txnId = transactionId || `TXN-${Date.now()}`;

        const result = await db.collection("appointments").updateOne(
            { _id: new ObjectId(id) },
            {
                $set: {
                    paymentStatus: "paid",
                    transactionId: txnId,
                    paidAt: new Date()
                }
            }
        );

        const appointment = await db.collection("appointments").findOne({ _id: new ObjectId(id) });
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

        res.json( result );
   
});


app.post("/api/reviews", async (req, res) => {
        const { appointmentId, doctorId, patientId, patientName, patientImage, rating, comment } = req.body;

        if (!doctorId || !patientId || !rating) {
            return res.status(400).json({ error: "Missing doctorId, patientId, or rating" });
        }

        const review = {
            appointmentId,
            doctorId,
            patientId,
            patientName: patientName || "Anonymous",
            patientImage: patientImage || "",
            rating: Number(rating),
            comment: comment || "",
            createdAt: new Date(),
        };

        const result = await db.collection("reviews").insertOne(review);

        const reviews = await db.collection("reviews").find({ doctorId }).toArray();
        const averageRating = reviews.reduce((acc, curr) => acc + curr.rating, 0) / reviews.length;

        await db.collection("doctors").updateOne(
            { userId: doctorId },
            { $set: { averageRating: parseFloat(averageRating.toFixed(1)), reviewCount: reviews.length } }
        );

        res.status(201).json( result );
});


app.get("/api/reviews", async (req, res) => {
    try {
        const reviews = await db.collection("reviews")
            .find({})
            .sort({ createdAt: -1 })
            .limit(3)
            .toArray();

        const enrichedReviews = [];
        for (const rev of reviews) {
            let doctorName = "Doctor";
            if (rev.doctorId) {
                const doctor = await db.collection("doctors").findOne({ userId: rev.doctorId });
                if (doctor) {
                    doctorName = doctor.name || "Doctor";
                }
                if (doctorName === "Doctor") {
                    const userQuery = {
                        $or: [
                            { _id: rev.doctorId },
                            { id: rev.doctorId }
                        ]
                    };
                    if (ObjectId.isValid(rev.doctorId)) {
                        userQuery.$or.push({ _id: new ObjectId(rev.doctorId) });
                    }
                    const user = await db.collection("user").findOne(userQuery);
                    if (user) doctorName = user.name || "Doctor";
                }
            }
            enrichedReviews.push({ ...rev, doctorName });
        }

        res.json(enrichedReviews);
    } catch (err) {
        console.error("Error fetching reviews:", err);
        res.status(500).json({ error: "Failed to fetch reviews" });
    }
});

app.get("/api/reviews/:doctorId", async (req, res) => {
        const { doctorId } = req.params;
        const reviews = await db.collection("reviews")
            .find({ doctorId })
            .sort({ createdAt: -1 })
            .toArray();
        res.json(reviews);
});



app.get("/api/users", async (req, res) => {
        const users = await db.collection("user").find({}).toArray();
        res.json(users);
});


app.patch("/api/users/:id/role", async (req, res) => {
        const { id } = req.params;
        const { role } = req.body;

        if (!["patient", "doctor", "admin"].includes(role)) {
            return res.status(400).json({ error: "Invalid role" });
        }

        let result = await db.collection("user").updateOne(
            { _id: id },
            { $set: { role } }
        );

        if (result.matchedCount === 0) {
            result = await db.collection("user").updateOne(
                { id: id },
                { $set: { role } }
            );
        }

        if (role === "doctor") {
            const exists = await db.collection("doctors").findOne({ userId: id });
            if (!exists) {
                await db.collection("doctors").insertOne({
                    userId: id,
                    specialization: "",
                    hospital: "",
                    fee: 0,
                    bio: "",
                    schedules: [],
                    verified: false,
                    createdAt: new Date(),
                });
            }
        }

        res.json({ message: `User role updated to ${role}`, result });
  
});


app.delete("/api/users/:id", async (req, res) => {
    const { id } = req.params;

    const queryId = ObjectId.isValid(id) ? new ObjectId(id) : id;
    let result = await db.collection("user").deleteOne({ _id: queryId });
    if (result.deletedCount === 0) {
        result = await db.collection("user").deleteOne({ _id: id });
    }
    if (result.deletedCount === 0) {
        result = await db.collection("user").deleteOne({ id });
    }

    await db.collection("doctors").deleteOne({ userId: id });
    await db.collection("appointments").deleteMany({ $or: [{ patientId: id }, { doctorId: id }] });

    res.json(result);
});

app.delete("/api/appointments/:id", async (req, res) => {
    const { id } = req.params;
    if (!ObjectId.isValid(id)) {
        return res.status(400).json({ error: "Invalid appointment ID format" });
    }
    const result = await db.collection("appointments").deleteOne({ _id: new ObjectId(id) });
    res.json(result);
});


app.get("/api/reviews", async (req, res) => {
    try {
        const reviews = await db.collection("reviews").find({}).sort({ createdAt: -1 }).limit(3).toArray();
        
        const userIds = [...new Set(reviews.map(r => r.patientId))];
        const users = await db.collection("user").find({ id: { $in: userIds } }).toArray();
        const userMap = new Map(users.map(u => [u.id, u.image]));

        const enrichedReviews = reviews.map(rev => ({
            ...rev,
            patientImage: rev.patientImage || userMap.get(rev.patientId) || "" // এখানে ইমেজ যোগ হচ্ছে
        }));

        res.json(enrichedReviews);
    } catch (err) {
        res.status(500).json({ error: "Failed" });
    }
});

app.get("/api/admin/stats", async (req, res) => {

        const totalUsers = await db.collection("user").countDocuments();

        const totalPatients = await db.collection("user").countDocuments({
            $or: [
                { role: "patient" },
                { role: { $exists: false } },
                { role: null }
            ]
        });

        const totalDoctors = await db.collection("user").countDocuments({ role: "doctor" });
        const verifiedDoctors = await db.collection("doctors").countDocuments({ verified: true });
        const totalAppointments = await db.collection("appointments").countDocuments();
        const totalReviews = await db.collection("reviews").countDocuments();

        const paidAppointments = await db.collection("appointments").find({ paymentStatus: "paid" }).toArray();
        const totalRevenue = paidAppointments.reduce((sum, appt) => sum + (appt.fee || 0), 0);

        const recentAppointments = await db.collection("appointments")
            .find({})
            .sort({ createdAt: -1 })
            .limit(5)
            .toArray();

        res.json({
            totalUsers,
            totalPatients,
            totalDoctors,
            verifiedDoctors,
            totalAppointments,
            totalReviews,
            totalRevenue,
            recentAppointments
        });
   
});



app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});