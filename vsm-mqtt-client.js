/*
The MIT License (MIT)

Copyright Sensative AB 2023. All rights reserved.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
*/

const mqtt = require('mqtt');

const fs = require('fs');
const translator = require('vsm-translator');
const { loadAlmanac, solvePosition } = require('./loracloudclient');
const { isDate } = require('util/types');

const printUsageAndExit = () => {
  console.log("Usage: node index.js [-v] -f <device id file> -i <integration name> -k <loracloud api key>");
  process.exit(1);
}

// Pick up command line options:
// -i <integration name>
// -f <File containing list of devEUIs, one on each line
// -k <api-key>  API key for loracloud
// -v Run in verbose mode
// Further options are defined in each integration 

const args = require('minimist')(process.argv.slice(2));
if (!(args.i && args.f))
  printUsageAndExit();

args.v && console.log("Selected integration: " + args.i);
args.v && console.log("Device file: " + args.f);


if (!fs.existsSync('storage'))
  fs.mkdirSync('storage');

//
// Create the list of devices (device ID dependent on each integration), as an array of files
//
let devices = [];
try {
  let devicefile = args.f;
  let text = fs.readFileSync(devicefile);
  if (!Buffer.isBuffer(text))
    throw new Error("Device list file is empty");
  let lines = text.toString("utf-8").split('\n');
  for (let i = 0; i < lines.length; ++i) {
    let name = lines[i].trim();
    if (name.startsWith("#") || name.length == 0)
      continue;
    args.v && console.log("Device ID: " + name);
    devices.push(name);
  }
  args.v && console.log("Device count: " + devices.length);
} catch (e) {
  console.log("Failed to read device file '" + args.f + "' : " + e.message);
  printUsageAndExit();
}

if (devices.length == 0) {
  console.log("No devices in device file");
  printUsageAndExit();
}

//
// Select which integration to use and load the integration
// 

let integration = undefined;
try {
  integration = require("./integrations/" + args.i);
  if (!(integration.api && integration.api.getVersionString && integration.api.checkArgumentsOrExit && integration.api.connectAndSubscribe)) {
    console.log("Integration " + args.i + " lacks a required function");
    process.exit(1);
  }
} catch (e) {
  console.log(e.message);
  printUsageAndExit();
}

// Allow the client to check its arguments (e.g. server, credentials, etc)
console.log("Integration: " + integration.api.getVersionString());
integration.api.checkArgumentsOrExit(args);

const ASSISTANCE_INTERVAL_S = 60; 
const downlinkAssistancePositionIfMissing = async (client, deviceid, next, lat, lng) => {
  if (lat && lng && next && next.gnss) {
    let updateRequired = false;
    if (next.gnss.lastAssistanceUpdateAttempt) {
      lastTime = new Date(next.gnss.lastAssistanceUpdateAttempt);
      now = new Date();
      console.log("Comparing time:", lastTime, now, now.getTime() - lastTime.getTime());
      if (now.getTime() - lastTime.getTime() < ASSISTANCE_INTERVAL_S*1000) {
        return next; // Do nothing
      }
    } 

    if (!next.gnss.assistanceLatitude || Math.abs(lat - next.gnss.assistanceLatitude) > 0.1)
      updateRequired = true;
    if (!next.gnss.assistanceLongitude || Math.abs(lng - next.gnss.assistanceLongitude) > 0.1)
      updateRequired = true;
    if (updateRequired) {
      next.gnss.lastAssistanceUpdateAttempt = new Date();

      const lat16 = Math.round(2048*lat / 90) & 0xffff;
      const lon16 = Math.round(2048*lng / 180) & 0xffff;
      let downlink = "01"; // Begin with 01 which indicates that this is a assisted position
      let str = lat16.toString(16);
      while (str.length < 4)
        str = "0"+str;
      downlink += str;
      str = lon16.toString(16);
      while (str.length < 4)
        str = "0"+str;
      downlink += str;
  
      integration.api.sendDownlink(client, args, deviceid, 21, Buffer.from(downlink, "hex"));
    }
  }
  return next;
}

const rules = [

  // Solve positions and add the solution to the data
  async (client, deviceid, next, updates, date, lat, lng) => {
    if (updates.semtechEncoded) {
      // Call semtech to resolve the location
      console.log("New positioning data");
      let solved = await solvePosition(args, updates);
      if (solved && solved.result && solved.result.latitude && solved.result.longitude) {
        // Extra check: If we have a result here but no assistance data in the device, use this to generate an assistance position
        // and downlink it to the device
        downlinkAssistancePositionIfMissing(client, deviceid, next, lat, lng);
        return solved.result;
      } else {
        return null;
      }
    }
  },

  // Detect absense of device assistance position OR the too large difference of lat & long vs assistance position
  async (client, deviceid, next, updates, date, lat, lng) => {
    // try download from gateway position only if there is no assistance position, else use solutions
    if (next.gnss && !next.gnss.assistanceLatitude)
      downlinkAssistancePositionIfMissing(client, deviceid, next, lat, lng);
  },

];

const processRules = async (client, deviceid, next, updates, date, lat, lng) => {
  console.log("processRules - updates:", deviceid, updates);
  for (let i = 0; i < rules.length; ++i) {
    synthesized = await rules[i](client, deviceid, next, updates, date, lat, lng);
    next = { ...next, ...synthesized};
  }
  return next;
}

// Function to handle uplinks for a device id on a port with binary data in buffer
const onUplinkDevicePortBufferDateLatLng = async (client, deviceid, port, buffer, date, lat, lng) => {
  if (!(typeof(deviceid) == "string" && isFinite(port) && Buffer.isBuffer(buffer) && isDate(date))) {
    console.log("Integration error: Bad parameter to onUplinkDevicePortBuffer");
    throw new Error("Bad parameter");
  }

  console.log("Uplink: device=" + deviceid + " port="+port + " buffer=" + buffer.toString("hex") + " date="+ date.toISOString() + " lat="+lat + " lng="+lng);

  // Read previous state for this node
  let previous = {};
  try {
    let buffer = fs.readFileSync(`storage/${deviceid}.json`);
    previous = JSON.parse(buffer.toString('utf-8'));
    // args.v && console.log("previous:", previous);
  } catch (e) {
    args.v && console.log(`Note: No previous data for device ${deviceid}`);
  }

  // Run translation
  let iotnode = { ...previous, 
    encodedData : {
        port : port,
        hexEncoded : buffer.toString('hex'),
        timestamp: date,  // TBD if this should be given by the integration instead?
    }
  }
  let result = {}
  try {
    const returned = translator.translate(iotnode);
    result = returned.result;
    let timeseries = returned.timeseries;
    // For now since there is no underlying timeseries database, ignore the timeseries part of the result
    args.v && timeseries && console.log("Ignoring timeseries data:", JSON.stringify(timeseries));
  } catch (e) {
    console.log("Failed translation: ", e.message);
    fs.writeFileSync(`storage/${deviceid}.err`, e.message);
  }

  let next = {...iotnode, ...result};
  next = await processRules(client, deviceid, next, result, date, lat, lng);

  try {
    // Write the updated data to some database instead, or push it somewhere.
    console.log(JSON.stringify(next));
    fs.writeFileSync(`storage/${deviceid}.json`, JSON.stringify(next));
  } catch (e) {
    console.log("Failed to write translation state to storage:", e.message);
  }
}

const delay = async (ms) => {
  await new Promise(resolve => setTimeout(resolve, ms));
}

const run = async () => {
  // Let the integration create connection and add required subscriptions
  let client = undefined;
  try {
    client = await integration.api.connectAndSubscribe(args, devices, onUplinkDevicePortBufferDateLatLng);
  } catch (e) {
    console.log("Failed to connect and subscribe: " + e.message);
    process.exit(1);
  }
  while (true) {
    args.v && console.log(new Date().toISOString() + " active");
    await delay(60000);
  }  
}

run();
