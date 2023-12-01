// Decoration which only provides the current values + the position 

module.exports.api = {
    decorate: (obj, deveui) => {
        let result = {};
        if (obj.output)
            result = JSON.parse(JSON.stringify(obj.output))
        result.latitude = obj.latitude;
        result.longitude = obj.longitude;
        result.accuracy = obj.accuracy;
        result.positionTimestamp = obj.positionTimestamp;
        result.appName = (obj.vsm && obj.vsm.appName) ? obj.vsm.appName : "unknown";
        return result;
    },
    getVersionString: () => {
        return "Minimal Object Decorator";
    }
}

