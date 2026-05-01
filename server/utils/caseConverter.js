function toSnake(str) {
  return str.replace(/([A-Z])/g, "_$1").toLowerCase();
}

function camelToSnake(obj) {
  if (Array.isArray(obj)) {
    return obj.map(v => camelToSnake(v));
  } else if (obj !== null && typeof obj === 'object') {
    return Object.keys(obj).reduce((acc, key) => {
      acc[toSnake(key)] = camelToSnake(obj[key]);
      return acc;
    }, {});
  }
  return obj;
}

module.exports = { camelToSnake };
