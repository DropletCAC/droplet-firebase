const functions = require("firebase-functions");
const admin = require('firebase-admin');
admin.initializeApp();


exports.newUser = functions.auth.user().onCreate((user) => {
    return admin.firestore()
      .collection("users")
      .doc(user.uid)
      .create(JSON.parse(JSON.stringify(user)));
  });

  
exports.updateUsage = functions.firestore.document("users/{userId}/meters/{meter}").onUpdate(async (change, context) => {
    console.log(change.after.data());
    let currentUsage = change.after.data()['currentUsage'];
    //timezone should be kept somewhere in the user metadata
    const today = new Date(new Date().toLocaleString("en-US", {timeZone: "America/Los_Angeles"}));
    const hour = today.getHours();
    const usage_ref = change.after.ref.collection("usage").doc(today.getFullYear().toString())
    const usage_snap = await usage_ref.get();
    console.log("Meter Usage", usage_snap.id)

    const previousUsage = usage_snap.data()[today.getMonth() + 1][today.getDate()][hour];
    let data = usage_snap.data();
    
    data[today.getMonth() + 1][today.getDate()][hour] = (parseInt(data[today.getMonth() + 1][today.getDate()][hour]) + parseInt(currentUsage));
    console.log("Hourly Meter Usage Updated", previousUsage, data[today.getMonth() + 1][today.getDate()][hour]);

    await usage_ref.set(data);
    

    const total_usage_ref = change.after.ref.parent.parent.collection("usage").doc(today.getFullYear().toString())
    const total_usage_snap = await total_usage_ref.get();

    const previousTotalUsage = total_usage_snap.data()[today.getMonth() + 1][today.getDate()][hour];
    let totalData = total_usage_snap.data();
    
    totalData[today.getMonth() + 1][today.getDate()][hour] = (parseInt(totalData[today.getMonth() + 1][today.getDate()][hour]) + parseInt(currentUsage));
    console.log("Total Usage Updated", previousTotalUsage, totalData[today.getMonth() + 1][today.getDate()][hour]);

    await total_usage_ref.set(totalData)

    return {"success": true}
});
