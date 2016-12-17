module.exports = function(Stock) {
  Stock.disableRemoteMethod("upsert",true);
  Stock.disableRemoteMethod("create",true);
  Stock.disableRemoteMethod("findById",true);
  Stock.disableRemoteMethod("exists",true);
  Stock.disableRemoteMethod("updateAttributes",false);
  Stock.disableRemoteMethod("deleteById",true);
  Stock.disableRemoteMethod("exists__0",true);
  Stock.disableRemoteMethod("__create__qty",false);
  Stock.disableRemoteMethod("__destroy__qty",false);
  Stock.disableRemoteMethod("__update__qty",false);
  Stock.disableRemoteMethod("__create__stocklogs",false);
  Stock.disableRemoteMethod("__delete__stocklogs",false);
  Stock.disableRemoteMethod("__findById__stocklogs",false);
  Stock.disableRemoteMethod("__updateById__stocklogs",false);
  Stock.disableRemoteMethod("__destroyById__stocklogs",false);
  Stock.disableRemoteMethod("updateAll",true);
  Stock.disableRemoteMethod("createChangeStream",true);
  Stock.disableRemoteMethod("createChangeStream__0",true);
  
  var mutex = require('mutex');
  var uuid = require('uuid');
  var async = require('async');
  var csv = require('fast-csv');
  var fs = require('fs');
  var path= require('path');
  var fork = require('child_process').fork;

  // Register a 'log' remote method: /stocks/code/log
  Stock.remoteMethod(  
    'log',
    {
      http: {path: '/log', verb: 'put'},
      accepts: [
        {arg: 'code', type: 'string', required: true},
        {arg: 'reason', type: 'string', required: true},
        {arg: 'ref', type: 'string', required: true},
        {arg: 'qty', type: 'number', required: true},
        {arg: 'costprice', type: 'number', required: false},
        {arg: 'notes', type: 'string', required: false},
        {arg: 'price', type: 'number', required: false},
        {arg: 'updby', type: 'number', required: false},
        {arg: 'customer', type: 'string', required: false},
      ],
      returns: {root: true, type: 'object'},
      description: 'enters a log of stock movement'
    }
  );
  
  Stock.log = function(code,reason,ref,qty,costprice,notes,price,updby,customer, cb) {
    var m = mutex({id: uuid.v4(), strategy: {name: 'redis'}});
    console.time("time consumed between lock & unlock")
    m.lock(code, { duration: 500 , maxWait: 10000 }, function (err, lock) {
      if(err) console.log("mutex errors",err)
      Stock.findOne({where: {skucode: code}}, function(err, record){
        if(err) cb(err);
        if(!err&&!record){
          var err= new Error("stock not found for skucode "+code);
          console.log(err)
          err.status=403;
          cb(err);
        }
        else{
          if(record && record._qty){
            if(!record._qty.ordered) record._qty["ordered"]=0;
            if(!record._qty.return) record._qty["return"]=0;
            if(!record._qty.damage) record._qty["damage"]=0;
            if(!record._qty.outbound) record._qty["outbound"]=0;
          }
          console.log("stock.log found stock for: ",record.skucode);
          //check the reason. then prepare stock log. prepare new stock. save stock log and stock.
          var b=record.qty.value();
          var after={};
          var cost=0; var _price=0; var customerId=0;
          var stockObj={};
          var stocklogObj={};
          var negmsg=""; var reference="";
          //if qty is <0 skip and err
          if(qty<0){
            var err = new Error("Qty can not be negative !");
            err.status = 403;
            return cb(err);
          }
          if(reason==="inchallan"){
            after={"total": b.total+qty, "forsale": b.forsale, "ordered":b.ordered, "return":b.return ,"damage":b.damage, 
              "inquote": b.inquote, "withds": b.withds, "onhold": b.onhold+qty, "outbound":b.outbound };
            if(costprice) cost=costprice;
            negmsg="forsale";reference="challancode";
          }else if(reason==="outchallan"){
            after={"total": b.total-qty, "forsale": b.forsale, "ordered":b.ordered, "return":b.return ,"damage":b.damage,
              "inquote": b.inquote, "withds": b.withds, "onhold": b.onhold, "outbound":b.outbound-qty};
            negmsg="outbound";reference="challancode";
          }else if(reason==="stage"){
            after={"total": b.total, "forsale": b.forsale+qty, "ordered":b.ordered, "return":b.return ,"damage":b.damage,
              "inquote": b.inquote, "withds": b.withds, "onhold": b.onhold-qty, "outbound":b.outbound };
            negmsg="onhold";reference="";
          }else if(reason==="unstage"){
            after={"total": b.total, "forsale": b.forsale-qty, "ordered":b.ordered, "return":b.return ,"damage":b.damage,
              "inquote": b.inquote, "withds": b.withds, "onhold": b.onhold+qty, "outbound":b.outbound };
            negmsg="forsale";reference="";
          /*}else if(reason==="toquote"){// need to check
            after={"total": b.total, "forsale": b.forsale-qty, "ordered":b.ordered, "return":b.return ,"damage":b.damage,
              "inquote": b.inquote+qty, "withds": b.withds, "onhold": b.onhold, "outbound":b.outbound };
            if(price) _price=price;
            if(customer) customerId=customer;
            negmsg="forsale";reference="qitemId";
          }else if(reason==="retquote"){// need to check
            after={"total": b.total, "forsale": b.forsale+qty, "ordered":b.ordered, "return":b.return ,"damage":b.damage,
              "inquote": b.inquote-qty, "withds": b.withds, "onhold": b.onhold, "outbound":b.outbound };
            if(price) _price=price;
            if(customer) customerId=customer;
            negmsg="inquote";reference="qitemId";*/
          }else if(reason==="ordered"){
            after={"total": b.total, "forsale": b.forsale-qty, "ordered":b.ordered+qty, "return":b.return ,"damage":b.damage,
              "inquote": b.inquote, "withds": b.withds, "onhold": b.onhold, "outbound":b.outbound};
            if(price) _price=price;
            if(customer) customerId=customer;
            negmsg="forsale";reference="oitemId";
          }else if(reason==="cancelorder"){
            after={"total": b.total, "forsale": b.forsale+qty, "ordered":b.ordered-qty, "return":b.return ,"damage":b.damage,
              "inquote": b.inquote, "withds": b.withds, "onhold": b.onhold, "outbound":b.outbound};
            if(price) _price=price;
            if(customer) customerId=customer;
            negmsg="ordered";reference="oitemId";
          }else if(reason==="toorder"){
            after={"total": b.total-qty, "forsale": b.forsale, "ordered":b.ordered-qty, "return":b.return ,"damage":b.damage,
              "inquote": b.inquote, "withds": b.withds, "onhold": b.onhold, "outbound":b.outbound};
            if(price) _price=price;
            if(customer) customerId=customer;
            negmsg="ordered";reference="oitemId";
          }else if(reason==="retorder"){
            after={"total": b.total+qty, "forsale": b.forsale, "ordered":b.ordered, "return":b.return+qty ,"damage":b.damage,
              "inquote": b.inquote, "withds": b.withds, "onhold": b.onhold, "outbound":b.outbound};
            if(price) _price=price;
            if(customer) customerId=customer;
            negmsg="forsale";reference="oitemId";
          }else if(reason==="ret2hold"){
            after={"total": b.total, "forsale": b.forsale, "ordered":b.ordered, "return":b.return-qty ,"damage":b.damage,
              "inquote": b.inquote, "withds": b.withds, "onhold": b.onhold+qty, "outbound":b.outbound};
            negmsg="return";reference="";
          }else if(reason==="ret2damage"){
            after={"total": b.total, "forsale": b.forsale, "ordered":b.ordered, "return":b.return-qty ,"damage":b.damage+qty,
              "inquote": b.inquote, "withds": b.withds, "onhold": b.onhold, "outbound":b.outbound};
            negmsg="return";reference="";
          }else if(reason==="sale2damage"){
            after={"total": b.total, "forsale": b.forsale-qty, "ordered":b.ordered, "return":b.return ,"damage":b.damage+qty,
              "inquote": b.inquote, "withds": b.withds, "onhold": b.onhold, "outbound":b.outbound};
            negmsg="forsale";reference="";
          }else if(reason==="damage2out"){
            after={"total": b.total, "forsale": b.forsale, "ordered":b.ordered, "return":b.return ,"damage":b.damage-qty,
              "inquote": b.inquote, "withds": b.withds, "onhold": b.onhold, "outbound":b.outbound+qty};
            negmsg="damage";reference="";
          }else if(reason==="damage2hold"){
            after={"total": b.total, "forsale": b.forsale, "ordered":b.ordered, "return":b.return ,"damage":b.damage-qty,
              "inquote": b.inquote, "withds": b.withds, "onhold": b.onhold+qty, "outbound":b.outbound};
            negmsg="damage";reference="";
          }else if(reason==="hold2damage"){
            after={"total": b.total, "forsale": b.forsale, "ordered":b.ordered, "return":b.return ,"damage":b.damage+qty,
              "inquote": b.inquote, "withds": b.withds, "onhold": b.onhold-qty, "outbound":b.outbound};
            negmsg="onhold";reference="";
          }else if(reason==="hold2out"){
            after={"total": b.total, "forsale": b.forsale, "ordered":b.ordered, "return":b.return ,"damage":b.damage,
              "inquote": b.inquote, "withds": b.withds, "onhold": b.onhold-qty, "outbound":b.outbound+qty};
            negmsg="onhold";reference="";
          }else if(reason==="out2hold"){
            after={"total": b.total, "forsale": b.forsale, "ordered":b.ordered, "return":b.return ,"damage":b.damage,
              "inquote": b.inquote, "withds": b.withds, "onhold": b.onhold+qty, "outbound":b.outbound-qty};
            negmsg="outbound";reference="";
         /* }else if(reason==="quoteorder"){
            after={"total": b.total-qty, "forsale": b.forsale,
              "inquote": b.inquote-qty, "withds": b.withds, "onhold": b.onhold};
            if(price) _price=price;
            if(customer) customerId=customer;
            negmsg="inquote";reference="oitemId";
          }else if(reason==="dsorder"){
            after={"total": b.total-qty, "forsale": b.forsale,
              "inquote": b.inquote, "withds": b.withds-qty, "onhold": b.onhold};
            if(price) _price=price;
            if(customer) customerId=customer;
            negmsg="withds";reference="oitemId";
          }else if(reason==="todropship"){
            after={"total": b.total, "forsale": b.forsale-qty,
              "inquote": b.inquote, "withds": b.withds+qty, "onhold": b.onhold};
            negmsg="forsale";reference="dropshipper";
          }else if(reason==="fromdropship"){
            after={"total": b.total, "forsale": b.forsale+qty,
              "inquote": b.inquote, "withds": b.withds-qty, "onhold": b.onhold};
            negmsg="withds";reference="dropshipper";*/
          }else{
            var err = new Error("Invalid reason");
            err.status = 403;
            return cb(err);
          }
          if(after[negmsg]<0){
            var err = new Error(negmsg+" qty can not go below 0");
            err.status = 403;
            cb(err);
          }else{
            var stocklogObj={};
            if(reference==""){
              stocklogObj={logqty:qty,
              notes:ref+" "+notes,reason:reason,stockId:record.id,updby:updby,_before:b,_after:after};
            }else{
              stocklogObj={logqty:qty,
              notes:notes,reason:reason,stockId:record.id,updby:updby,_before:b,_after:after};
              stocklogObj[reference]=ref;
            }
            if(cost) stocklogObj["costprice"]=cost;
            if(_price) stocklogObj["saleprice"]=_price;
            if(customerId) stocklogObj["customer"]=customerId;
            Stock.app.models.Stocklog.create(stocklogObj, function(err,stocklog){
              if(err) console.log(err); 
              console.log("stock.log created stocklog : ",stocklog);
              if(!err){
                if(reason=="inchallan" && costprice!=0){
                  Stock.app.models.product.findById(record.productId,function(err,p){
                    if(err) console.log(err);
                    else{
                      var meta= p.meta;
                      meta["costprice"]=costprice;
                      p.updateAttributes({'meta':meta},function(err,done){
                        if(err) console.log(err)
                      })
                    }
                  })
                }
                var qty=stocklog.after();
                var cost=0; if(stocklog.costprice) cost=stocklog.costprice;
                var stockObj={_qty:qty}; if(cost) stockObj["costprice"]=cost;
                console.log("updating stock from stocklog");
                record.updateAttributes(stockObj, function(err, instance){
                  if(err) console.log(err);
                  else{
                    m.unlock(lock, function (err) {
                      if(err) console.log(err);
                      console.timeEnd("time consumed between lock & unlock")
                    })
                  }
                });
                cb(null, stocklog);
              }
            });
          }
        }
      })
    })
  };

  Stock.observe('before save', function(ctx, next){
    var ci= ctx.instance;
    if(ci && ci._qty){
      if(!ci._qty.ordered) ci._qty["ordered"]=0;
      if(!ci._qty.return) ci._qty["return"]=0;
      if(!ci._qty.damage) ci._qty["damage"]=0;
      if(!ci._qty.outbound) ci._qty["outbound"]=0;
    }
    next();
  })

  Stock.observe('after save', function(ctx, next){
    //console.log("forsale is ",ctx.instance.qty().forsale);
    if(ctx.instance.qty().forsale>0) {
      if(ctx.instance.skuId){
        ctx.instance.sku(function(err,sku){
          if(!sku.instock){ sku.updateAttributes({"instock":true},function(err,instance){
            if(err) next(err);
            else Stock.app.models.product.index(ctx.instance.productId,function(err,done){
              if(err) console.log(err)
            });
          })}else{
            Stock.app.models.product.index(ctx.instance.productId,function(err,done){
              if(err) console.log(err)
            });
          }
        })
      }else if(ctx.instance.productId){
        ctx.instance.product(function(err,product){
          if(!product.instock){ product.updateAttributes({"instock":true},function(err,instance){
            if(err) next(err);
            else Stock.app.models.product.index(instance.id,function(err,done){
              if(err) console.log(err)
            });
          })}else{
            Stock.app.models.product.index(product.id,function(err,done){
              if(err) console.log(err)
            });
          }
        })
      }
    }else if (ctx.instance.qty().forsale===0) {
      if(ctx.instance.skuId){
        ctx.instance.sku(function(err,sku){
          if(sku.instock){ sku.updateAttributes({"instock":false},function(err,instance){
            if(err) next(err);
            else Stock.app.models.product.index(ctx.instance.productId,function(err,done){
              if(err) console.log(err)
            });
          })}else{
            Stock.app.models.product.index(ctx.instance.productId,function(err,done){
              if(err) console.log(err)
            });
          }
        })
      }else if(ctx.instance.productId){
        ctx.instance.product(function(err,product){
          if(product.instock){ product.updateAttributes({"instock":false},function(err,instance){
            if(err) next(err);
            else Stock.app.models.product.index(instance.id,function(err,done){
              if(err) console.log(err)
            });
          })}else{
            Stock.app.models.product.index(product.id,function(err,done){
              if(err) console.log(err)
            });
          }
        })
      }
    }
    next();
  });

  Stock.remoteMethod(  
    'upload',
    {
      http: {path: '/upload', verb: 'post'},
      accepts: [
        {arg: 'req', type: 'object',http: {source: 'req'}},
      ],
      returns: {root: true, type: 'object'},
      description: 'upload stock log'
    }
  );

  Stock.upload=function(req,callback){
    var Container, FileUpload, containerName;
    Container = Stock.app.models.Container;
    FileUpload = Stock.app.models.FileUpload;
    containerName = "stock-" + (Math.round(Date.now())) + "-" + (Math.round(Math.random() * 1000));
    return async.waterfall([
      function(done) {
        return Container.createContainer({
          name: containerName
        }, done);
      }, function(container, done) {
        req.params.container = containerName;
        return Container.upload(req, {}, done);
      }, function(fileContainer, done) {
        return FileUpload.create({
          date: new Date(),
          fileType: Stock.modelName,
          status: 'PENDING'
        }, function(err, fileUpload) {
          return done(err, fileContainer, fileUpload);
        });
      }
    ], function(err, fileContainer, fileUpload) {
      var params;
      if (err) {
        return callback(err);
      }
      console.log("fileContainer=>",fileContainer)
      var updby=1;
      if(fileContainer.fields && fileContainer.fields.updby && isNaN(fileContainer.fields.updby)==false){
        var updby=fileContainer.fields.updby[0];
      }
      params = {
        fileUpload: fileUpload.id,
        root: Stock.app.datasources.container.settings.root,
        container: fileContainer.files.file[0].container,
        updby: updby,
        file: fileContainer.files.file[0].name
      };
      fork(__dirname + '/../../server/scripts/import-stocklog.js', [JSON.stringify(params)]);
      return callback(null, fileUpload);
    });
  }

  Stock["import"] = function(container, file, options, callback) {
    return Stock.import_process( container, file, options, function(importError,result) {
      if (importError) {
        return async.waterfall([
          function(done) {
            return Stock.import_postprocess_error( container, file, options,result, done);
          }, function(done) {
            return Stock.import_clean( container, file, options, done);
          }
        ], function() {
          return callback(importError);
        });
      } else {
        return async.waterfall([
          function(done) {
            return Stock.import_postprocess_success( container, file, options, result, done);
          }, function(done) {
            return Stock.import_clean( container, file, options, done);
          }
        ], function() {
          return callback(null);
        });
      }
    });
  };

  Stock.import_process = function( container, file, options, callback) {
    var fileContent, filename, stream;
    fileContent = [];
    filename = path.join(Stock.app.datasources.container.settings.root, container, file);
    var ftype=path.extname(filename);
    if(ftype!=".csv"){
      var err=new Error("file format is not valid");
      return Stock.app.models.FileUploadError.create({
        line: 0,
        message: err.message,
        fileUploadId: options.fileUpload
      }, callback(err));
    }
    stream = csv({
      delimiter: ',',
      headers: true
    });
    stream.on('data', function(data) {
      return fileContent.push(data);
    });
    stream.on('end', function() {
      var errors, j, ref, results;
      errors = []; var result=[];
      return async.mapSeries((function() {
        results = [];
        for (var j = 0, ref = fileContent.length; 0 <= ref ? j <= ref : j >= ref; 0 <= ref ? j++ : j--) results.push(j); 
        return results;
      }).apply(this), function(i, done) {
        if (fileContent[i] == null) {
          return done();
        }
        return Stock.import_handleLine( fileContent[i], options, function(err,slog) {
          if (err) {
            errors.push(err);
            return Stock.app.models.FileUploadError.create({
              line: i + 2,
              message: err.message,
              fileUploadId: options.fileUpload
            }, done(null));
          } else {
            if(slog)
              result.push(slog)
            return done();
          }
        });
      }, function() {
        if (errors.length > 0) {
          if (result.length > 0) {
            return callback(errors,result);
          }else{
            return callback(errors);
          }
        }
        if(result.length > 0) {
          return callback(null,result);
          }
        return callback();
      });
    });
    return fs.createReadStream(filename).pipe(stream);
  };
  
  Stock.import_postprocess_success = function( container, file, options, result, callback) {
    return Stock.app.models.FileUpload.findById(options.fileUpload, function(err, fileUpload) {
      if (err) {
        return callback(err);
      }
      fileUpload.status = 'SUCCESS';
      fileUpload.result = result;
      return fileUpload.save(callback);
    });
  };
  Stock.import_postprocess_error = function( container, file, options, result, callback) {
    return Stock.app.models.FileUpload.findById(options.fileUpload, function(err, fileUpload) {
      if (err) {
        return callback(err);
      }
      fileUpload.status = 'ERROR';
      fileUpload.result = result;
      return fileUpload.save(callback);
    });
  };
  Stock.import_clean = function( container, file, options, callback) {
    return Stock.app.models.Container.destroyContainer(container, callback);
  };

  Stock.import_handleLine = function( line, uploadData, next) {
    return LineHandlers.validate(line, function(err) {
      if (err) {
        return next(err);
      }
      return LineHandlers.createStocklog( line, uploadData, function(err,slog){
        if(err) return next(err);
        else return next(null,slog)
      });
    });
  };
  return LineHandlers = {
    validate: function(line, next) {
      if (line.skucode === '') {
        return this.rejectLine('skucode', line.skucode, 'Missing skucode', next);
      }
      if (line.reason === '') {
        return this.rejectLine('reason', line.reason, 'Missing reason of skucode '+line.reason, next);
      }
      if (line.reference === '') {
        return this.rejectLine('reference', line.reference, 'Missing reference of skucode '+line.skucode, next);
      }
      if (line.quantity === '') {
        return this.rejectLine('quantity', line.quantity, 'Missing quantity of skucode '+line.skucode, next);
      }
      if (isNaN(line['quantity'])) {
        return this.rejectLine('quantity', line.quantity, 'quantity is not a number', next);
      }
      if (isNaN(line['costprice'])) {
        return this.rejectLine('costprice', line.costprice, 'costprice is not a number', next);
      }
      return next();
    },

    createStocklog: function( line, uploadData, next) {
      var quantity=parseInt(line.quantity)
      var updby=uploadData.updby;
      Stock.log(line.skucode,line.reason,line.reference,quantity,line.costprice,line.notes,line.price,updby,"none",function(err,data){
        if(err) return next(err);
        else {
          var result={"ref":line.skucode, "id":data.stockId, "msg":"success"};
          return next(null, result);
        }
      })
    },
    rejectLine: function(columnName, cellData, customErrorMessage, callback) {
      var err = new Error("Unprocessable entity in column " + columnName + " where data = " + cellData + " : " + customErrorMessage);
      err.status = 422;
      return callback(err);
    } 
  }
};
