module.exports = function(Media) {
  Media.observe('before save', function(ctx, next){
  	if(ctx.isNewInstance)
  	ctx.instance.unsetAttribute('id');
  	next();
  })
};
