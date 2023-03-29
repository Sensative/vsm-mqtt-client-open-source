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

// Functions for storage. Optimally this storage would be in a database rather than
// just reading/writing to the file system. Also a RAM cache would be a nice improvement,
// BUT consider that it is possible to have multiple instances running which would break
// consistency if the same device is present in multiple lora network servers (roaming).

const fs = require('fs');

// If the store is not initialized and requires initialization, do that here
module.exports.initializeStore = () => {
    if (!fs.existsSync('storage'))
        fs.mkdirSync('storage');
}

module.exports.fetchObjectFromStore = (deviceid) => {
    let buffer = fs.readFileSync(`storage/${deviceid.toLowerCase()}.json`);
    return JSON.parse(buffer.toString('utf-8'));
}

module.exports.putObjectInStore = (deviceid, obj) => {
    try {
        fs.writeFileSync(`storage/${deviceid.toLowerCase()}.json`, JSON.stringify(obj));
    } catch (e) {
      console.log("Failed to write translation state to storage:", e.message);
    }
}

module.exports.putErrorInStore = (deviceId, e) => {
    let filename = "storage/errors.txt";
    const text = new Date().toISOString() + " " + deviceId.toLowerCase() + " " + e.message + "\n";
    try {
        fs.appendFile(filename, text);
    } catch (e) {}
}

//
// Return a list of device IDs applicable to the selected integration
//
module.exports.readDeviceList = (devicefile) => {
    let devices = [];
    try {
        let buffer = fs.readFileSync(devicefile);
        if (!Buffer.isBuffer(buffer))
            throw new Error("Device list file " + devicefile + " is empty");
        let lines = buffer.toString("utf-8").split('\n');
        for (let i = 0; i < lines.length; ++i) {
            let name = lines[i].trim();
            if (name.startsWith("#") || name.length == 0)
                continue;
            devices.push(name);
        }
        console.log("Device count: " + devices.length);
    } catch (e) {
        console.log("Failed to read device file '" + devicefile + "' : " + e.message);
    }
    return devices;
}
