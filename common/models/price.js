module.exports = function(Price) {
  Price.observe('before save', function(ctx, next){
  	ctx.hookState.bprice=(ctx.currentInstance)?ctx.currentInstance.price:"";
    if(ctx.isNewInstance){
      ctx.instance.unsetAttribute('id');
      ctx.instance.created=new Date();
    }
    next();
  });
  Price.observe('after save', function(ctx, next){
  	var bprice=ctx.hookState.bprice;
  	var ci=ctx.instance;
    if(bprice!=ci.price){
      var pObj={"code":ci.code,"group":ci.group,"price":ci.price,"mrp":ci.mrp,"notes":ci.notes,"activ":ci.activ,
  			"updated":ci.updated,"updby":ci.updby,"logtime":new Date(),"bprice":bprice,"aprice":ci.price};
      ctx.instance.pricelogs.create(pObj,function(err,data){
        if(err) console.log("price log Error",err);
      })
    }
    next();
  });
};
