const { Expo } = require('expo-server-sdk')
const functions = require("firebase-functions");
const { defineSecret } = require('firebase-functions/params');
const admin = require('firebase-admin');
const fetch = require('node-fetch');

const { OpenAI } = require('openai');
const OPENAI_API_KEY = defineSecret('OPENAI_API_KEY');


admin.initializeApp();

const flask_url = "https://bengal-sought-bedbug.ngrok-free.app/"
let expo = new Expo()


exports.newUser = functions.auth.user().onCreate((user) => {
    return admin.firestore()
      .collection("users")
      .doc(user.uid)
      .create(JSON.parse(JSON.stringify(user)));
  });

async function sendToExpo(messages) {
  let chunks = expo.chunkPushNotifications(messages);
  let tickets = [];
  (async () => {
    for (let chunk of chunks) {
      try {
        let ticketChunk = await expo.sendPushNotificationsAsync(chunk);
        console.log(ticketChunk);
        tickets.push(...ticketChunk);
      } catch (error) {
        console.error(error);
      }
    }
  }) ();

  return true
};

async function sendNotifications(userId, leak_data) {
  const snap = await admin
    .firestore()
    .collection("users")
    .doc(userId)
    .get()
  
  const userData = snap.data()
  const pushToken = userData['expoPushToken']

  if (!Expo.isExpoPushToken(pushToken)) {
    console.error(`Push token ${pushToken} is not a valid Expo push token`);
  }
  const messages = []
  messages.push({
    to: pushToken,
    sound: 'default',
    title: 'Possibe Leak Warning!',
    body: `A Possible Leak Has Been Detected In: ${leak_data.section}`,
  })

  return await sendToExpo(messages)
};


async function generateTip(userId) {
    const apiKey = OPENAI_API_KEY.value()
    const openai = new OpenAI({
      apiKey: apiKey,
    });
    
    const data = {}
    const today = new Date()

    const meters = []
    const querySnapshot = await admin
      .firestore()
      .collection("users")
      .doc(userId)
      .collection("meters")
      .get();
    
    querySnapshot.forEach((doc) => {
      meters.push(doc.id)
    });


    for await (const meter of meters) {
        const snap = await admin 
          .firestore()
          .collection("users")
          .doc(userId)
          .collection("meters")
          .doc(meter)
          .collection("usage")
          .doc("2023")
          .get()
        
        
        data[meter] = snap.data()[(today.getMonth() + 1).toString()]
    
    }

    console.log(meters, data)
    const chatCompletion = await openai.chat.completions.create({
      messages: [{ role: 'user', content: `${data}\n\n\n
      Above is data for household water usage for this month in JSON format. The data is broken down into each respective section of the house, followed by the day represented as a number from 1-31 which links to a 24-item long integer indicating how much water was used each hour. 
      \nYou are an inspector for the local company and you have been asked to come up with a, concise, one-sentence, but specific helpful tip to help this household conserve its water. Your tip must be backed up by actual data that was provided. 
      \nExample 1: "50% of your water usage this month was from your lawn! Try turning it down this month!" 
      \nExample 2: "Your water usage peaks at 5 PM every day, try reducing your usage at this time` }],
      model: 'gpt-3.5-turbo',
    });
  
    console.log(chatCompletion.choices);

    await admin 
      .firestore()
      .collection("users")
      .doc(userId)
      .collection("tips")
      .add({
        content: chatCompletion.choices[0].message.content.replace(/["']/g, ""),
        date: today,
      })
}

exports.tips = functions.https.onRequest(async(request, response) => {
  await generateTip("BwyZV2GQN0O1DVDsGl4BAj9W5q92")
  response.send("ok")
});


exports.updateUsage = functions.firestore.document("users/{userId}/meters/{meter}").onUpdate(async (change, context) => {
    console.log("UPDATED")
    console.log("Meter Changed:", change.after.data());

    let currentUsage = parseInt(change.after.data()['currentUsage']);
    //timezone should be kept somewhere in the user metadata
    const today = new Date(new Date().toLocaleString("en-US", {timeZone: "America/Los_Angeles"}));
    const hour = today.getHours();
    const month = today.getMonth() + 1
    const day = today.getDate()
    const meter = change.after.id;
    const userId = change.after.ref.parent.parent.id 

    const usage_ref = change.after.ref.collection("usage").doc(today.getFullYear().toString())
    const usage_snap = await usage_ref.get();
    let data = usage_snap.data();
    
    const previousUsage = data[month][day][hour];

    if (!previousUsage) {
      console.log("New Hour... Checking for leaks")
      
      console.log("Checking to see if halfway through month...")
      if (month > 15) {
        console.log("Rolling dice...")
        let dice = Math.floor(Math.random() * 10)
        if (dice == 9) {
          await generateTip(userId)
        }
      }

      const response = await fetch(`${flask_url}leak?user=${userId}&section=${meter}&month=${month}&day=${day}&hour=${hour - 1}`);

      console.log(`${flask_url}leak?user=${userId}&section=${meter}&month=${month}&day=${day}&hour=${hour - 1}`)
      
      const leak_data = await response.json()
      console.log("Leak Data", leak_data)

      if (leak_data.leak) {
        leak_data.leak.date = new Date(leak_data.leak.date)
        console.log("Leak Detected!!!")
        await admin.firestore()
          .collection("users")
          .doc(userId)
          .collection("leaks")
          .add(leak_data.leak)

        await sendNotifications(userId, leak_data.leak)
      }

      data[month][day][hour] = 0
    }

    data[month][day][hour] = (parseInt(data[month][day][hour]) + currentUsage);
    console.log("Hourly Meter Usage Updated", previousUsage, data[month][day][hour]);

    await usage_ref.set(data);
    

    const total_usage_ref = change.after.ref.parent.parent.collection("usage").doc(today.getFullYear().toString())
    const total_usage_snap = await total_usage_ref.get();
    let totalData = total_usage_snap.data();

    const previousTotalUsage = totalData[month][day][hour];
    if (!previousTotalUsage) {
      console.log("Total Usage entry for this hour does not exist, setting to 0")
      totalData[month][day][hour] = 0
    }

    totalData[month][day][hour] = (parseInt(totalData[month][day][hour]) + currentUsage);
    console.log("Total Usage Updated", previousTotalUsage, totalData[month][day][hour]);

    await total_usage_ref.set(totalData)

    return {"success": true}
});

exports.updateBuckets = functions.firestore.document("users/{userId}/buckets/{bucket}").onUpdate(async (change, context) => {
  console.log("BUCKET UPDATED");
  const data = change.after.data()
  const userId = change.after.ref.parent.parent.id 

  if ((data['currentCapacity'] / data['totalCapacity']) > 0.1) {
    console.log("Plenty of water!")
    await change.after.ref.update({sentNotif: false})

  } else if (!data['sentNotif']) {
    console.log("Water Level Low! Sending notif")

    const snap = await admin
    .firestore()
    .collection("users")
    .doc(userId)
    .get()
  
    const userData = snap.data()
    const pushToken = userData['expoPushToken']


    if (!Expo.isExpoPushToken(pushToken)) {
      console.error(`Push token ${pushToken} is not a valid Expo push token`);
    }

    const messages = []
    messages.push({
      to: pushToken,
      sound: 'default',
      title: "Low Tank Warning!",
      body: `Your tank "${change.after.id}" is at 10% capacity`,
    })

    await sendToExpo(messages)
    await change.after.ref.update({sentNotif: true})
  }
});
