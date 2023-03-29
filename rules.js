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

const { mergeDeep, delay } = require('./util');
const { loadAlmanac, solvePosition } = require('./loracloudclient');

const ASSISTANCE_INTERVAL_S =  60*30; // max 300km/h
const MAX_ALMANAC_AGE_S =   60*60*24*30; // This is a monthly process
const ALMANAC_DOWNLOAD_INTERVAL_S = 60*60*12; // No more frequent tries than this

const downlinkAssistancePositionIfMissing = async (args, integration, client, deviceid, next, lat, lng) => {
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
  
      integration.api.sendDownlink(client, args, deviceid, 21, Buffer.from(downlink, "hex"), false /* confirmed */ );
    }
  }
  return next;
}

const downlinkAlmanac = async (args, integration, client, deviceid) => {
    const f = async () => {
        const almanac = await loadAlmanac(args);
        if (!(almanac && almanac.result && almanac.result.almanac_image)) {
            console.log("Bad alamanac data");
            return;
        }
    
        const compressedAlmanac = almanac.result.almanac_compressed;
        const image = compressedAlmanac ? compressedAlmanac : almanac.result.almanac_image;
    
        let maxDownlinkSize = 40; // Give space for some mac commands
        const almanacTypeStr = (compressedAlmanac ? "Compressed" : "Full");
        console.log("Almanac image type: " + almanacTypeStr);
        console.log("Selected payload size: " + maxDownlinkSize);
        console.log("Almanac image size: " + image.length / 2 );
        console.log("Downlink count: " + image.length / 2 / maxDownlinkSize);
    
        let chunks = image.match(new RegExp('.{1,' + (maxDownlinkSize*2 /* 40 is randomly selected */ ) + '}', 'g'));
        console.log("Chunks: " + chunks.length);
    
        for (let i = 0; i < chunks.length; ++i) {
            var data;
            if (i === 0) // Begin new almanac
                data = "02";
            else if (i === chunks.length-1) {
                if (compressedAlmanac)
                    data = "05"; // End compressed almanac
                else
                    data = "04"; // End uncompressed almanac
            }
            else
                data = "03"; // Plain almanac segment
            data += chunks[i];

            try {
                await integration.api.sendDownlink(client, args, deviceid, 21, Buffer.from(data, "hex"), true);
                console.log(deviceid, almanacTypeStr + " Almanac downlink " + (i+1) + " of " + chunks.length + " - enqueueing");
                await delay(1000); // Increase chance of correct order in chirpstack
            } catch (e) { return; }
        }
    }
    // Do not await the results here
    f();
}


const rules = [

  // Solve positions and add the solution to the data
  async (args, integration, client, deviceid, next, updates, date, lat, lng) => {
    if (updates.semtechEncoded) {
      // Call semtech to resolve the location
      console.log("New positioning data");
      let solved = await solvePosition(args, updates);
      if (solved && solved.result && solved.result.latitude && solved.result.longitude) {
        // Extra check: If we have a result here but no assistance data in the device, use this to generate an assistance position
        // and downlink it to the device
        downlinkAssistancePositionIfMissing(args, integration, client, deviceid, next, lat, lng);
        return solved.result;
      } else {
        return null;
      }
    }
  },

  // Detect absense of device assistance position OR the too large difference of lat & long vs assistance position,
  // try to solve that by downloading new assistance position
  async (args, integration, client, deviceid, next, updates, date, lat, lng) => {
    // try download from gateway position only if there is no assistance position, else use solutions
    if (next.gnss && !next.gnss.assistanceLatitude)
      downlinkAssistancePositionIfMissing(args, integration, client, deviceid, next, lat, lng);
  },

  // Detect if almanac download is called for
  async (args, integration, client, deviceid, next, updates, date, lat, lng) => {
    // Do we know if there is an almanac timestamp?
    if (!(next.gnss && next.gnss.almanacTimestamp))
        return next;

    const almanacDate = new Date(next.gnss.almanacTimestamp);
    if (date.getTime() - almanacDate.getTime() < MAX_ALMANAC_AGE_S*1000)
        return next; // Unmodified

    const lastAttemptMs = next.gnss.lastAlmanacDownloadAttempt ? new Date(next.gnss.lastAlmanacDownloadAttempt).getTime() : 0;
    const lastAttemptPeriodS = (date.getTime() - lastAttemptMs)/1000;
    if (lastAttemptPeriodS < ALMANAC_DOWNLOAD_INTERVAL_S)
        return next; // Do not attempt a download now
    next.gnss.lastAlmanacDownloadAttempt = date;

    // Run this asynchronously rather than wait
    downlinkAlmanac(args, integration, client, deviceid);

    return next;
  },

];

module.exports.processRules = async (args, integration, client, deviceid, next, updates, date, lat, lng) => {
  // console.log("processRules - updates:", deviceid, updates);
  for (let i = 0; i < rules.length; ++i) {
    synthesized = await rules[i](args, integration, client, deviceid, next, updates, date, lat, lng);
    next = mergeDeep(next, synthesized);
  }
  return next;
}
