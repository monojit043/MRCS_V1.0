const recalculateZones = require("./services/recalculateZones");

async function run(){

    await recalculateZones(1);

    console.log("Zone recalculation finished");

}

run();