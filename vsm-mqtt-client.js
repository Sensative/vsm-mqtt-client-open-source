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

const mqtt = require('mqtt')
const fs = require('fs');
const translator = require('vsm-translator');

const printUsageAndExit = () => {
  console.log("Usage: node index.js -f <device id file> -i <integration name> ");
  process.exit(1);
}

// Pick up command line options:
// -i <integration name>
// -f <File containing list of devEUIs, one on each line
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

const processRules = (deviceid, next, updates) => {
  console.log("processRules", deviceid, updates);
}

// Function to handle uplinks for a device id on a port with binary data in buffer
const onUplinkDevicePortBufferDateLatLng = (deviceid, port, buffer, lat, lng) => {
  if (!(typeof(deviceid) == "string" && isFinite(port) && Buffer.isBuffer(buffer))) {
    console.log("Integration error: Bad parameter to onUplinkDevicePortBuffer");
    throw new Error("Bad parameter");
  }

  console.log("Handling uplink: device=" + deviceid + " port="+port + " buffer=" + buffer.toString("hex"));

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
        timestamp: new Date(),  // TBD if this should be given by the integration instead?
    }
  }
  let result = {}
  try {
    let returned = translator.translate(iotnode);
    result = returned.result;
    let timeseries = returned.timeseries;
    // For now since there is no underlying timeseries database, ignore the timeseries part of the result
    args.v && timeseries && console.log("Ignoring timeseries data:", JSON.stringify(timeseries));
  } catch (e) {
    console.log("Failed translation: ", e.message);
    fs.writeFileSync(`storage/${deviceid}.err`, e.message);
  }

  let next = {...iotnode, ...result};
  processRules(next, result);

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
    client = await integration.api.connectAndSubscribe(args, devices, onUplinkDevicePortBuffer);
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
