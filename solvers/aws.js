const AWS = require('aws-sdk');
AWS.config.apiVersions = {
    iotwireless: '2020-11-22',
    // other service API versions
};

// Set the region and user credentials
const config = {
    accessKeyId: 'AKIA6NZJE5645HRQPDGV',
    secretAccessKey: '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',
    region: 'eu-west-1',
    // other service API versions
}
// Create the service object (IotWireless- Service)
const iotwireless = new AWS.IoTWireless(config);

const solvePosition = async (args, data) => {
  console.log('*************************');
  console.log('AWS SOLVER');
  console.log('dataaaaa in aws solver', data);
  const resultData = {};
  if (!args.k) return;
  
  const isWifi = data.semtechEncoded && (data.semtechEncoded.msgtype === "wifi");

  let body = isWifi ? data.wifi : (data.semtechEncoded ? data.semtechEncoded : data.semtechGpsEncoded);
  body = JSON.parse(JSON.stringify(body)); // Make a copy of this object since it is manipulated below
  if (isWifi) {
    if ((!body.wifiAccessPoints) || body.wifiAccessPoints.length < 2) {
      console.log(data);
      throw new Error("Not enough access points to resolve wifi position")
    }
    body.wifiAccessPoints.forEach((accessPoint) => {
      accessPoint.Rss = accessPoint.signalStrength;
      delete accessPoint.signalStrength;
      accessPoint.MacAddress = accessPoint.macAddress
      delete accessPoint.macAddress;
    });
    const params = {
      WiFiAccessPoints: body.wifiAccessPoints,
    }
    console.log ('Sending request to AWS to resolve position');
    console.log('Params: ', params);
    const test = iotwireless.getPositionEstimate(JSON.stringify(params), function(err, response) {
      if (err) {
          console.log('Something went wrong when calling "getPositionEstimate"', err, err.stack);
        } else {
          const buf = Buffer.from(response.GeoJsonPayload);
          const decodedString = buf.toString();
          const decodedResponse = JSON.parse(decodedString);
          args.v && console.log("AWS solver response:", decodedResponse);
          resultData = {
            latitude: decodedResponse?.coordinates[1],
            longitude: decodedResponse?.coordinates[0],
            verticalAccuracy: decodedResponse?.properties?.verticalAccuracy,
            verticalConfidenceLevel: decodedResponse?.properties?.verticalConfidenceLevel,
            horizontalAccuracy: decodedResponse?.properties?.horizontalAccuracy,
            horizontalConfidenceLevel: decodedResponse?.properties?.horizontalConfidenceLevel,
            positionTimestamp: decodedResponse?.properties?.timestamp,
          }
        }
    });
    // console.log('Logga test?', test);
    return resultData;
  } else {
    console.log('*************************');
    console.log('GNSS NOT IMPLEMENTED YET');
    console.log('*************************');
    return;
  }
}

module.exports.api = {
    solvePosition,
    checkArgumentsOrExit: (args)=>{if (!args.k) throw new Error("-k <Access Key and Secret Key> is required for AWS"); },
    getVersionString: ()=>"AWS Solver",
    initialize: (args) => {}
};
