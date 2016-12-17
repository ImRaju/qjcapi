module.exports = function(Sku) {

  Sku.observe('before save', function(ctx, next){
    //if new instance no product?
    var oinstock=false;
    var errFn=function(err, product){
      if(err) next(err);
      if(!product.hasopts){
        var err= new Error("define related product to bear options!");
        err.status= 403;
        return next(err);
      }
    };
    if(ctx.isNewInstance){
      ctx.instance.unsetAttribute('id');
      ctx.instance.created=new Date();
      Sku.app.models.Product.findOne({where:{id:ctx.instance.productId}}, errFn);
      //Sku.validatesUniquenessOf('code', {message: 'sku code is not unique'});
      Sku.findOne({where:{"code":ctx.instance.code}},function(err,found){
        if(err) next(err);
        if(found){
          var err= new Error("sku code is not unique");
          err.statusCode= 400;
          return next(err);
        }else{
          ctx.hookState.oinstock=oinstock;
          next();
        }
      })
    }else if(ctx.currentInstance){
      ctx.currentInstance.product(errFn);
      oinstock=ctx.currentInstance.instock;
      ctx.hookState.oinstock=oinstock;
      next();
    }else if(ctx.instance){
      ctx.instance.product(errFn);
      ctx.hookState.oinstock=oinstock;
      next();
    }
  });

  var mutex = require('mutex');
  var uuid = require('uuid');

  Sku.observe('after save', function(ctx, next){
    var ninstock=ctx.instance.instock;var oinstock=ctx.hookState.oinstock;
    console.log("oinstock ",oinstock," ninstock ",ninstock);
    var m = mutex({id: uuid.v4(), strategy: {name: 'redis'}});
    console.time("time consumed between lock & unlock");
    m.lock(ctx.instance.code, { duration: 500 , maxWait: 10000 }, function (err, lock) {
      ctx.instance.stock(function(err,instance){
        if(err || !instance){
          //if there is stock for sku already, reset that
          Sku.app.models.Stock.findOne({where:{skucode:ctx.instance.code}}, function(err, stock){
            if(err || !stock){
              //if no stock found, create it
              console.log("no stock for this sku, so better create ", ctx.instance.code);
              ctx.instance.stock.create({skucode:ctx.instance.code,activ:true,_qty:{
                total:0,forsale:0,inquote:0,withds:0,onhold:0,ordered:0,return:0,damage:0,outbound:0},productId:ctx.instance.productId}, function(err, stock){
                  if(err) next(err);
                  else{
                    m.unlock(lock, function (err) {
                      if(err) console.log(err);
                      console.timeEnd("time consumed between lock & unlock")
                    })
                  }
              })
            }else{
              //set skuId as well, since its not there in stock. checked above.
              stock.updateAttributes({activ:true,_qty:{total:0,forsale:0,inquote:0,withds:0,onhold:0,ordered:0,return:0,damage:0,outbound:0}
              ,skuId:ctx.instance.id,productId:ctx.instance.productId},function(err,stock){
                if(err) next(err);
                else{
                  m.unlock(lock, function (err) {
                    if(err) console.log(err);
                    console.timeEnd("time consumed between lock & unlock")
                  })
                }
              });
            }
          });
        }else{
          m.unlock(lock, function (err) {
            if(err) console.log(err);
            console.timeEnd("time consumed between lock & unlock")
          })
        }
      });
    })
    //update products instock=true from false, if sku instock was true. =false if no sku instock
    if(ninstock!=oinstock){
      Sku.app.models.Product.findOne({include:"skus",where:{id:ctx.instance.productId}},function(err,product){
        if(err) next(err);
        var instock=false;
        product.skus().forEach(function(sku){
          if(sku.instock) instock=true;
        });
        if(product.instock!=instock){
          console.log("need to product instock ",product.code);
          product.updateAttributes({"instock":instock},function(err,instance){
            if(err) next(err);
            else Sku.app.models.product.index(instance.id, function(err,done){
              if(err) next(err);
            });
            console.log("updated product instock ",product.code);
          });
        }
      })
    };
    next();
  });
};
