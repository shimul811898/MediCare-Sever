require("dotenv").config();
const dns = require("dns");
if (!process.env.VERCEL && process.env.NODE_ENV !== "production") {
    try {
        dns.setServers(["8.8.8.8", "8.8.4.4"]);
        dns.setDefaultResultOrder("ipv4first");
    } catch (e) {
        console.warn("Failed to set DNS servers:", e);
    }
}

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
    const users = await db.collection("user").find({}).toArray();
    console.log(JSON.stringify(users.map(u => ({ _id: u._id, id: u.id, name: u.name, role: u.role, email: u.email })), null, 2));
  } catch (err) {
    console.error(err);
  } finally {
    await client.close();
  }
}

run();
