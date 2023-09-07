const functions = require("firebase-functions");
const admin = require('firebase-admin');
const fetch = require('node-fetch');
admin.initializeApp();

const flask_url = "http://localhost:50000/"
exports.newUser = functions.auth.user().onCreate((user) => {
    return admin.firestore()
      .collection("users")
      .doc(user.uid)
      .create(JSON.parse(JSON.stringify(user)));
  });


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

      await fetch(`${flask_url}leak?user=${userId}&section=${meter}&month=${month}&day=${day}&hour=${hour - 1}`);

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
