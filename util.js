// Deep merge function from
// https://stackoverflow.com/questions/27936772/how-to-deep-merge-instead-of-shallow-merge
// ... could have included lodash but trying to avoid dependencies

const { isDate } = require('util/types');



const isObject = (item) => {
    return (item && typeof item === 'object' && !Array.isArray(item) && !isDate(item));
}
  
const mergeDeep = (target, source) => {
    let output = Object.assign({}, target);
    if (isObject(target) && isObject(source)) {
        Object.keys(source).forEach(key => {
        if (isObject(source[key])) {
            if (!(key in target))
            Object.assign(output, { [key]: source[key] });
            else
            output[key] = mergeDeep(target[key], source[key]);
        } else {
            Object.assign(output, { [key]: source[key] });
        }
        });
    }
    return output;
}

const delay = async (ms) => {
    await new Promise(resolve => setTimeout(resolve, ms));
}
    
module.exports.mergeDeep = mergeDeep;
module.exports.delay = delay;
