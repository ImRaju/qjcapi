module.exports = function(Model, options) {
  // Model is the model class
  // options is an object containing the config properties from model definition
  Model.defineProperty('updby', {type: Number, default: 0});
  Model.defineProperty('activ', {type: Boolean, default:true});
}
