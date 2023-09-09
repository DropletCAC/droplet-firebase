const { Expo } = require('expo-server-sdk')
const functions = require("firebase-functions");
const admin = require('firebase-admin');
const fetch = require('node-fetch');
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
}


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
    body: `Possible Leak Has Been Detected In: ${leak_data.section}`,
  })

  return await sendToExpo(messages)
};

exports.updateUsage = functions.firestore.document("users/{userId}/meters/{meter}").onUpdate(async (change, context) => {
    console.log("Meter Changed:", change.after.data());

    let currentUsage = change.after.data()['currentUsage'];
    //timezone should be kept somewhere in the user metadata
    const today = new Date(new Date().toLocaleString("en-US", {timeZone: "America/Los_Angeles"}));
    const hour = today.getHours();
    const month = today.getMonth() + 1
    const day = today.getDate()
    const meter = change.after.id;
    const userId = change.after.ref.parent.parent.id 

    console.log("Attempting to access:", month, day, hour)
    const usage_ref = change.after.ref.collection("usage").doc(today.getFullYear().toString())
    const usage_snap = await usage_ref.get();
    let data = usage_snap.data();
    
    const previousUsage = data[today.getMonth() + 1][today.getDate()][hour];

    if (!previousUsage) {
      console.log("New Hour... Checking for leaks")

      console.log(meter, userId, month, day, hour)

      const response = await fetch(`${flask_url}leak?user=${userId}&section=${meter}&month=${month}&day=${day}&hour=${hour - 1}`);
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

      data[today.getMonth() + 1][today.getDate()][hour] = 0
    }

    data[today.getMonth() + 1][today.getDate()][hour] = (parseInt(data[today.getMonth() + 1][today.getDate()][hour]) + parseInt(currentUsage));
    console.log("Hourly Meter Usage Updated", previousUsage, data[today.getMonth() + 1][today.getDate()][hour]);

    await usage_ref.set(data);
    

    const total_usage_ref = change.after.ref.parent.parent.collection("usage").doc(today.getFullYear().toString())
    const total_usage_snap = await total_usage_ref.get();
    let totalData = total_usage_snap.data();

    const previousTotalUsage = totalData[today.getMonth() + 1][today.getDate()][hour];
    if (!previousTotalUsage) {
      console.log("shit is nan, setting to 0")
      totalData[today.getMonth() + 1][today.getDate()][hour] = 0
    }

    totalData[today.getMonth() + 1][today.getDate()][hour] = (parseInt(totalData[today.getMonth() + 1][today.getDate()][hour]) + parseInt(currentUsage));
    console.log("Total Usage Updated", previousTotalUsage, totalData[today.getMonth() + 1][today.getDate()][hour]);

    await total_usage_ref.set(totalData)

    return {"success": true}
});
