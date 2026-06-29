import { MongoClient } from "mongodb"
const url = "mongodb+srv://jhashiv200:Mondodb%40123@cluster0.ytfa9ks.mongodb.net/?appName=Cluster0"
const dbName = "chat-app"
export const collectionName = "user-detail"
const client = new MongoClient(url)
export const connection = async()=>{
    const connect = await client.connect();
    return await connect.db(dbName)
}