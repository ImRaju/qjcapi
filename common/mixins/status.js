module.exports = function(Model, options) {
  Model.defineProperty('status', {type: String, required: true, default: 'pending'});
  Model.defineProperty('statusdate', {type: Date, required: true, default: '$now'});
}
