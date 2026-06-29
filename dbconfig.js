import { MongoClient } from "mongodb"
import dotenv from "dotenv"

dotenv.config()

const url = process.env.MONGODB_URI
const dbName = process.env.DB_NAME || "chat-app"
export const collectionName = "user-detail"
const client = new MongoClient(url)
export const connection = async () => {
  const connect = await client.connect()
  return await connect.db(dbName)
}