const { MongoClient } = require("mongodb");

const uri = process.env.MONGODB_URI;
const client = new MongoClient(uri);

async function run() {
  try {
    await client.connect();
    const db = client.db("medicare");
    
    console.log("--- DOCTORS COLLECTION ---");
    const doctors = await db.collection("doctors").find({}).toArray();
    console.log(JSON.stringify(doctors.map(d => ({ _id: d._id, userId: d.userId, specialization: d.specialization, hospital: d.hospital, verified: d.verified, schedules: d.schedules })), null, 2));
    
    console.log("\n--- USER COLLECTION ---");
    const users = await db.collection("user").find({ role: "doctor" }).toArray();
    console.log(JSON.stringify(users.map(u => ({ id: u.id, name: u.name, role: u.role, image: u.image })), null, 2));
  } catch (err) {
    console.error(err);
  } finally {
    await client.close();
  }
}

run();
