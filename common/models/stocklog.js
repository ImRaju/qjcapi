module.exports = function(Stocklog) {
  //now stock is updated from stock.log
  /*Stocklog.observe('after save', function(ctx, next){
    var qty=ctx.instance.after();
    var cost=0; if(ctx.instance.costprice) cost=ctx.instance.costprice;
    var stockObj={_qty:qty}; if(cost) stockObj["costprice"]=cost;
    console.log("finding stock for stocklog");
    ctx.instance.stock(function(err, stock){
      if(err) next(err);
      console.log("updating stock from stocklog");
      stock.updateAttributes(stockObj, function(err, instance){
        if(err) next(err);
      });
    });
    next();
  });*/
};
