var solr=require("solr-client");

module.exports = function(Product) {
  Product.disableRemoteMethod('upsert',true);
  Product.disableRemoteMethod('updateAll',true);
  Product.disableRemoteMethod('deleteById',true);
  Product.disableRemoteMethod('__update__stock',false);
  Product.disableRemoteMethod('__create__stock',false);
  Product.disableRemoteMethod('__destroy__stock',false);
  Product.disableRemoteMethod('__create__stocks',false);
  Product.disableRemoteMethod('__delete__stocks',false);
  Product.disableRemoteMethod('__findById__stocks',false);
  Product.disableRemoteMethod('__updateById__stocks',false);
  Product.disableRemoteMethod('__destroyById__stocks',false);
  Product.disableRemoteMethod('__count__stocks',false);
  Product.disableRemoteMethod('__exists__stocks',false);
  Product.disableRemoteMethod('__link__stocks',false);
  Product.disableRemoteMethod('__unlink__stocks',false);
  Product.disableRemoteMethod('createChangeStream',true);
  Product.disableRemoteMethod('createChangeStream__0',true);
  Product.disableRemoteMethod("__updateById__skus",false);

  var mutex = require('mutex');
  var uuid = require('uuid');

  Product.observe('before save', function(ctx, next){
    //TODO: problem with error details compounding in product import with loopback validator
    //Product.validatesUniquenessOf('code', {message: 'code is not unique'});
    if(ctx.isNewInstance){
      ctx.instance.unsetAttribute('id');
      ctx.instance._infos=[];
      ctx.instance.created=new Date();
      Product.findOne({where:{"code":ctx.instance.code}},function(err,found){
        if(err) next(err);
        else if(found){
          var err= new Error("Product code is not unique");
          err.statusCode= 400;
          next(err);
        }else{
          next();
        }
      })
    }else{
      next();
    }
  });

  Product.observe('after save', function(ctx, next){
    var m = mutex({id: uuid.v4(), strategy: {name: 'redis'}});
    console.time("time consumed between lock & unlock");
    if(!ctx.instance.hasopts){
      m.lock(ctx.instance.code, { duration: 500 , maxWait: 10000 }, function (err, lock) {
        ctx.instance.stock(function(err,instance){
          if(err || !instance){
            Product.app.models.Stock.findOne({where: {skucode:ctx.instance.code}}, function(err, stock){
              if(err || !stock){
                //if no stock found, create it
                console.log("no stock for this Product sku, so better create ",ctx.instance.code);
                ctx.instance.stock.create({skucode:ctx.instance.code,activ:true,_qty:{
                  total:0,forsale:0,inquote:0,withds:0,onhold:0,ordered:0,return:0,damage:0,outbound:0}}, function(err, stock){
                    if(err) next(err);
                    else{
                      m.unlock(lock, function (err) {
                        if(err) console.log(err);
                        console.timeEnd("time consumed between lock & unlock")
                      })
                    }
                    //if(!err) next(null,stock);
                })
              }else{
                //if there is stock for sku already, reset that
                console.log("reset existing stock record %o",stock);
                stock.updateAttributes({activ:true,_qty:{total:0,forsale:0,inquote:0,withds:0,onhold:0,ordered:0,return:0,damage:0,outbound:0}
                },function(err,stock){
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
    }
    else{
      ctx.instance.stock(function(err,instance){
        if(!err && instance && instance.skucode){
          if(instance.skucode==ctx.instance.code)
            instance.destroy();
        }
      });
    }
    next();
  });

  // Register a 'skusdetails' remote method: /product/skusdetails
  Product.remoteMethod(
    'skudetails',
    {
      http: {path: '/skudetails', verb: 'post'},
      accepts: [
        {arg: 'skucode', type: 'array', required: true},
      ],
      returns: {root: true, type: 'object'},
      description: 'product details for sku '
    }
  );
  Product.skudetails = function(skucode,next){
    Product.app.models.stock.find({where:{'skucode':{inq:skucode}},
      include:[{relation:"product",scope:{include:'prices',fields:['code','title','desc','_infos','meta']}},"sku"]},function(err,stock){
        if(err) next(err);
        else {
          //if stock is present
          if(stock.length)
            next(null,stock);
          else{
            //if absent Only for first skucode
            var upc=skucode[0];
            //find in sku upc
            Product.app.models.sku.findOne({where:{"upc":upc}}, function(err,s){
              if(err) next(err);
              else if(s){
                //skucode found
                Product.app.models.stock.find({where:{'skucode':s.code},
                  include:[{relation:"product",scope:{include:'prices',fields:['code','title','desc','_infos','meta']}},"sku"]},function(err,stock2){
                    if(err) next(err);
                    else next(null,stock2);
                });
              }else{
                //if not -find in product has opts false upc
                Product.findOne({where:{"meta.upc":upc,"hasopts":false}}, function(err,p){
                  if(err) next(err);
                  else if(p){
                    //pcode found
                    Product.app.models.stock.find({where:{'skucode':p.code},
                      include:[{relation:"product",scope:{include:'prices',fields:['code','title','desc','_infos','meta']}},"sku"]},function(err,stock3){
                        if(err) next(err);
                        else next(null,stock3);
                    });
                  }else{
                    //not found
                    var err= new Error("skucode/upc is not valid");
                    err.status=404;
                    next(err);
                  }
                })
              }
            })
          }
        }
    });
  }

  // Register a 'skus' remote method: /product/skus
  Product.remoteMethod(
    'updatesku',
    {
      http: {path: '/:id/updatesku/:fk', verb: 'put'},
      accepts: [
        {arg: 'id', type: 'string', required: true},
        {arg: 'fk', type: 'string', required: true},
        {arg: 'size', type: 'string', required: false},
        {arg: 'upc', type: 'string', required: false},
        {arg: 'activ', type: 'boolean', required: true},
        {arg: 'updby', type: 'number', required: false},
      ],
      returns: {root: true, type: 'object'},
      description: 'update product sku '
    }
  );
  Product.updatesku = function(id,fk,size,upc,activ,updby,next) {
    Product.app.models.sku.findById(fk, function(err, s){
      if(err) next(err);
      if(!s){
        var err= new Error("sku not found");
        err.statusCode= 404;
        return next(err)
      }
      if(s && s.productId==id){
        s.updateAttributes({activ:activ, size:size, upc:upc, updby:updby}, function(err, result){
          if(err) next(err);
          if(!err) next(null, result);
        })
      }else{
        var err= new Error("product id is not valid for this sku");
        err.statusCode= 403;
        next(err);
      }
    })
  }

  // Register a 'index' remote method: /product/index
  Product.remoteMethod(  
    'index',
    {
      http: {path: '/index', verb: 'post'},
      accepts: [
        {arg: 'id', type: 'string', required: true},
      ],
      returns: {root: true, type: 'object'},
      description: 'indexes a product of given id'
    }
  );

  Product.index = function(id,next) {
    var result={};var pObj={};
    Product.findById(id,{"include":["prices","skus","stock","stocks","media"]}, function(err, p){
      if(err) next(err);
      //console.log("indexing product: ",p);
      //console.log("solr params: ",Product.app.get("solrParams"));
      var client=solr.createClient(Product.app.get("solrParams"));
      var pcode=p.code;var skucode=p.code;var metal="";var finish="";var stone=[];var photo="";var price={};
      var sizes=[]; var upc=[];
      //if no options calculate product stock and set to index
      var stock=0;
      if(!p.hasopts){
        stock=p.stock().qty().forsale;
        if(p.meta.upc!==undefined)
          upc.push(p.meta.upc);
      }
      if(p.hasopts && p.skus()){
        skucode=[];
        p.skus().forEach(function(sku){
          skucode.push(sku.code);
          sizes.push(sku.size);
          if(sku.upc)
            upc.push(sku.upc);
        });
        //calculate total stock and set to index
        p.stocks().forEach(function(skustock){
          stock+=skustock.qty().forsale;
        });
      }
      //only one photo with seq=0 is indexed
      if(p.media()){
        p.media().some(function(media, index, arr){
          if(media.seq===0) photo=media.filename;
          return media.seq===0;
        });
      }
      //use metal and stone(s) depending on set value
      if(p._infos){
        p._infos.forEach(function(info){
          //console.log("info.set ",info.set);
          if(info.set==="metal"){
            metal=info.title;
            finish=info.meta.finish;
          }
          if(info.set==="stone") stone.push(info.title);
        });
      }
      pObj={"id":p.id,"pcode":pcode,"skucode":skucode,"itemtype":p.meta.itemtype,"hasopts":p.hasopts,
        "title":p.title,"desc":p.desc,"brand":p.brand,"sample":p.sample,"instock":p.instock,
        "sizes":sizes,"upc":upc,"created":p.created,"updated":p.updated,"updby":p.updby,"activ":p.activ,
        "photo":photo,"metal":metal,"meta_s_finish":finish,"stone":stone,"stock":stock};
      //prices !!
      if(p.prices()){
        p.prices().forEach(function(price){
          if(price.activ){
            pObj["price_"+price.code+"_"+price.group]=price.price;
            pObj["mrp_"+price.code+"_"+price.group+"_d"]=price.price;
          }
        });
      }
      // general meta
      if(p.meta){
        for(var key in p.meta){
          if(p.meta.hasOwnProperty(key)){
            //console.log("key ",key," type ",typeof p.meta[key]);
            if((typeof p.meta[key])=="boolean") pObj["meta_b_"+key]=p.meta[key];
            if((typeof p.meta[key])=="number") pObj["meta_tf_"+key]=p.meta[key];
            if((typeof p.meta[key])=="string") pObj["meta_s_"+key]=p.meta[key];
          }
        }
      }
      client.add(pObj,function(err,obj){
        if(err) next(err);
        client.commit(function(err,res){
          if(err) console.log(err);
          if(res) console.log(res);
        });
        if(!err) next(null,obj);
      });
    });
  };

// Register a 'multiIndex' remote method: /product/multiIndex
  Product.remoteMethod(  
    'multiIndex',
    {
      http: {path: '/multiIndex', verb: 'post'},
      accepts: [
        {arg: 'where', type: 'object', http: { source: 'query' }, description: 'Criteria to match model instances'},
        {arg: 'skip', type: 'number'},
        {arg: 'limit', type: 'number'},
      ],
      returns: {root: true, type: 'object'},
      description: 'indexes a product of given id'
    }
  );

  Product.multiIndex = function(where,skip,limit,next){
    var result=[];var pObj={};
    var client=solr.createClient(Product.app.get("solrParams"));
    Product.find({"where":where,"include":["prices","skus","stock","stocks","media"],"skip":skip,"limit":limit},function(err,products){
      if(err) next(err);
      products.forEach(function(p){
        var pcode=p.code;var skucode=p.code;var metal="";var finish="";var stone=[];var photo="";var price={};
        var sizes=[]; var upc=[];
        //if no options calculate product stock and set to index
        var stock=0;
        if(!p.hasopts){
          stock=p.stock().qty().forsale;
          if(p.meta.upc!==undefined)
            upc.push(p.meta.upc);
        }
        if(p.hasopts && p.skus()){
          skucode=[];
          p.skus().forEach(function(sku){
            skucode.push(sku.code);
            sizes.push(sku.size);
            if(sku.upc)
              upc.push(sku.upc);
          });
          //calculate total stock and set to index
          p.stocks().forEach(function(skustock){
            stock+=skustock.qty().forsale;
          });
        }
        //only one photo with seq=0 is indexed
        if(p.media()){
          p.media().some(function(media, index, arr){
            if(media.seq===0) photo=media.filename;
            return media.seq===0;
          });
        }
        //use metal and stone(s) depending on set value
        if(p._infos){
          p._infos.forEach(function(info){
            console.log("info.set ",info.set);
            if(info.set==="metal"){
              metal=info.title;
              finish=info.meta.finish;
            }
            if(info.set==="stone") stone.push(info.title);
          });
        }
        pObj={"id":p.id,"pcode":pcode,"skucode":skucode,"itemtype":p.meta.itemtype,"hasopts":p.hasopts,
          "title":p.title,"desc":p.desc,"brand":p.brand,"sample":p.sample,"instock":p.instock,
          "sizes":sizes,"upc":upc,"created":p.created,"updated":p.updated,"updby":p.updby,"activ":p.activ,
          "photo":photo,"metal":metal,"meta_s_finish":finish,"stone":stone,"stock":stock};
        //prices !!
        if(p.prices()){
          p.prices().forEach(function(price){
            if(price.activ){
              pObj["price_"+price.code+"_"+price.group]=price.price;
              pObj["mrp_"+price.code+"_"+price.group+"_d"]=price.price;
            }
          });
        }
        // general meta
        if(p.meta){
          for(var key in p.meta){
            if(p.meta.hasOwnProperty(key)){
              console.log("key ",key," type ",typeof p.meta[key]);
              if((typeof p.meta[key])=="boolean") pObj["meta_b_"+key]=p.meta[key];
              if((typeof p.meta[key])=="number") pObj["meta_tf_"+key]=p.meta[key];
              if((typeof p.meta[key])=="string") pObj["meta_s_"+key]=p.meta[key];
            }
          }
        }
        result.push(pObj);
      });
      client.add(result,function(err,obj){
        if(err) next(err);
        client.commit(function(err,res){
          if(err) console.log(err);
          if(res) console.log(res);
        });
        if(!err) return next(null,obj);
      });
    });
  }

  var async = require('async');
  var csv = require('fast-csv');
  var fs = require('fs');
  var path= require('path');
  var fork = require('child_process').fork;
  var result=[];

  Product.remoteMethod(  
    'upload',
    {
      http: {path: '/upload', verb: 'post'},
      accepts: [
        {arg: 'req', type: 'object',http: {source: 'req'}},
      ],
      returns: {root: true, type: 'object'},
      description: 'upload product'
    }
  );

  Product.upload=function(req,callback){
    var Container, FileUpload, containerName;
    Container = Product.app.models.Container;
    FileUpload = Product.app.models.FileUpload;
    containerName = "product-" + (Math.round(Date.now())) + "-" + (Math.round(Math.random() * 1000));
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
          fileType: Product.modelName,
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
      console.log("fileContainer=>",fileContainer.files.file[0])
      params = {
        fileUpload: fileUpload.id,
        root: Product.app.datasources.container.settings.root,
        container: fileContainer.files.file[0].container,
        file: fileContainer.files.file[0].name,
        type: "product"
      };
      fork(__dirname + '/../../server/scripts/import-products.js', [JSON.stringify(params)]);
      return callback(null, fileUpload);
    });
  }

  Product.remoteMethod(  
    'uploadPrice',
    {
      http: {path: '/uploadPrice', verb: 'post'},
      accepts: [
        {arg: 'req', type: 'object',http: {source: 'req'}},
      ],
      returns: {root: true, type: 'object'},
      description: 'upload product price'
    }
  );
  Product.uploadPrice=function(req,callback){
    var Container, FileUpload, containerName;
    Container = Product.app.models.Container;
    FileUpload = Product.app.models.FileUpload;
    containerName = "price-" + (Math.round(Date.now())) + "-" + (Math.round(Math.random() * 1000));
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
          fileType: Product.app.models.price.modelName,
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
      console.log("fileContainer=>",fileContainer.files.file[0])
      params = {
        fileUpload: fileUpload.id,
        root: Product.app.datasources.container.settings.root,
        container: fileContainer.files.file[0].container,
        file: fileContainer.files.file[0].name,
        type: "price"
      };
      fork(__dirname + '/../../server/scripts/import-products.js', [JSON.stringify(params)]);
      return callback(null, fileUpload);
    });
  }

  Product["import"] = function(container, file, options, callback) {
    return Product.import_process( container, file, options, function(importError,result) {
      if (importError) {
        return async.waterfall([
          function(done) {
            return Product.import_postprocess_error( container, file, options, result, done);
          }, function(done) {
            return Product.import_clean( container, file, options, done);
          }
        ], function() {
          return callback(importError);
        });
      } else {
        return async.waterfall([
          function(done) {
            return Product.import_postprocess_success( container, file, options, result, done);
          }, function(done) {
            return Product.import_clean( container, file, options, done);
          }
        ], function() {
          return callback(null);
        });
      }
    });
  };

  Product.import_process = function( container, file, options, callback) {
    var fileContent, filename, stream;
    fileContent = [];
    filename = path.join(Product.app.datasources.container.settings.root, container, file);
    var ftype=path.extname(filename);
    if(ftype!=".csv"){
      var err=new Error("file format is not valid");
      return Product.app.models.FileUploadError.create({
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
      errors = [];var result=[];
      return async.mapSeries((function() {
        results = [];
        for (var j = 0, ref = fileContent.length; 0 <= ref ? j <= ref : j >= ref; 0 <= ref ? j++ : j--) results.push(j); 
        return results;
      }).apply(this), function(i, done) {
        if (fileContent[i] == null) {
          return done();
        }
        return Product.import_handleLine( fileContent[i], options, function(err,pObj) {
          if (err) {
            errors.push(err);
            return Product.app.models.FileUploadError.create({
              line: i + 2,
              message: err.message,
              fileUploadId: options.fileUpload
            }, done(null));
          } else {
            if(pObj){
              result.push(pObj);
            }
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
        if (result.length > 0) {
          return callback(null,result);
        }
        return callback();
      });
    });
    return fs.createReadStream(filename).pipe(stream);
  };
  
  Product.import_postprocess_success = function( container, file, options, result, callback) {
    return Product.app.models.FileUpload.findById(options.fileUpload, function(err, fileUpload) {
      if (err) {
        return callback(err);
      }
      fileUpload.status = 'SUCCESS';
      fileUpload.result = result;
      return fileUpload.save(callback);
    });
  };
  Product.import_postprocess_error = function( container, file, options, result, callback) {
    return Product.app.models.FileUpload.findById(options.fileUpload, function(err, fileUpload) {
      if (err) {
        return callback(err);
      }
      fileUpload.status = 'ERROR';
      fileUpload.result = result;
      return fileUpload.save(callback);
    });
  };
  Product.import_clean = function( container, file, options, callback) {
    return Product.app.models.Container.destroyContainer(container, callback);
  };

  Product.import_handleLine = function( line, uploadData, next) {
    if(uploadData.type=="price"){
      return LineHandler.validatePrice(line, function(err) {
        if (err) {
          return next(err);
        }
        return LineHandler.updatePrice( line,uploadData, function(err,pObj){
          if(err){
            return next(err)
          }
          return next(null,pObj)
        });
      });
    }else{
      return LineHandler.validate(line, function(err) {
        if (err) {
          return next(err);
        }
        return LineHandler.createProduct( line,uploadData, function(err,pObj){
          if(err){
            return next(err)
          }
          return next(null,pObj)
        });
      });
    }
  };
  return LineHandler = {
    validate: function(line, next) {
      if (line.SKU === '') {
        return this.rejectLine('SKU', line.SKU, 'Missing SKU', next);
      }
      if (line.Title === '') {
        return this.rejectLine('Title', line.Title, 'Missing Title of SKU '+line.SKU, next);
      }
      if (line.Description === '') {
        return this.rejectLine('Description', line.Description, 'Missing Description of SKU '+line.SKU, next);
      }
      if (isNaN(line['MRP'])) {
        return this.rejectLine('MRP', line.MRP, 'MRP is not a number', next);
      }
      if (isNaN(line['JD Price'])) {
        return this.rejectLine('JD Price', line["JD Price"], 'JD Price is not a number', next);
      }
      if (isNaN(line['QJC Price'])) {
        return this.rejectLine('QJC Price', line["QJC Price"], 'QJC Price is not a number', next);
      }
      if (isNaN(line['DS Price'])) {
        return this.rejectLine('DS Price', line["DS Price"], 'DS Price is not a number', next);
      }
      return next();
    },

    validatePrice: function(line, next) {
      if (line.productcode === '') {
        return this.rejectLine('productcode', line.productcode, 'Missing productcode', next);
      }
      if (isNaN(line['QJ'])) {
        return this.rejectLine('QJ', line.QJ, 'QJ price is not a number', next);
      }
      if (isNaN(line['OL'])) {
        return this.rejectLine('OL', line.OL, 'OL price is not a number', next);
      }
      if (isNaN(line['DS'])) {
        return this.rejectLine('DS', line.DS, 'DS price is not a number', next);
      }
      if (isNaN(line['costprice'])) {
        return this.rejectLine('costprice', line.costprice, 'costprice is not a number', next);
      }
      if (isNaN(line['MSRP'])) {
        return this.rejectLine('MSRP', line["MSRP"], 'MSRP is not a number', next);
      }
      if (isNaN(line['MAP'])) {
        return this.rejectLine('MAP', line["MAP"], 'MAP is not a number', next);
      }
      return next();
    },

    createProduct: function( line, uploadData, done) {
      var result={};
      console.log("%% product skucode"+line.SKU);
      return Product.findOne({where:{code: line.SKU}}, function(error, found) {
        var product; var hasopts=0; var activ=false;
        if (error) {
          return done(error);
        }
        if (found) {
          var err = new Error("Product already exists with skucode " + line.SKU );
          err.status = 422;
          return done(err);
        }        
        var hasopts=false;
        if(line.childsku=="TRUE")
          hasopts=true;
        var meta={};
        if(line['Active (True or False)']=="TRUE")
          var activ=true;
        if(line.Category)
          meta["itemtype"]=line.Category;
        if(line['Active_on_qjc (True or False)']=="TRUE")
          meta["qjc"]=true;
        else  meta["qjc"]=false;
        if(line['Active_on_jd (True or False)']=="TRUE")
          meta["jd"]=true;
        else meta["jd"]=false;
        if(line['Active_on_dropshipper (True or False)']=="TRUE")
          meta["dropshipper"]=true;
        else meta["dropshipper"]=false;
        if(line['Active_on_sss (True or False)']=="TRUE")
          meta["sss"]=true
        else  meta["sss"]=false;
        if(line["Length(mm)"])
          meta["length"]=line["Length(mm)"];
        if(line["Height(mm)"])
          meta["height"]=line["Height(mm)"];
        if(line["Width(mm)"])
          meta["width"]=line["Width(mm)"];
        if(line["Product Wt.(gm)"])
          meta["productwt"]=line["Product Wt.(gm)"];
        if(line["Total Stone Wt.(ctw)"])
          meta["totalstonewt"]=line["Total Stone Wt.(ctw)"];
        /*if(line["Total Metal Wt."])
          meta["totalmetalwt"]=line["Total Metal Wt."]*/
        if(line["Main Stone"])
          meta["mainstone"]=line["Main Stone"]
        if(line["Main Stone Color"])
          meta["mainstcolor"]=line["Main Stone Color"]
        if(line["Main Stone Month"])
          meta["bsotm"]=line["Main Stone Month"]
        if(line["Setting"])
          meta["setting"]=line["Setting"]
        if(line["Back Finding"])
          meta["backfinding"]=line["Back Finding"]
        if(line["Clasptype"])
          meta["clasptype"]=line["Clasptype"]
        if(line["Chaintype"])
          meta["chaintype"]=line["Chaintype"]

        product = { "code": line.SKU, "title": line.Title, "desc":line.Description, "hasopts":hasopts, "instock":false, 
          "updby":0, "activ":activ, "meta":meta };

        var infos=[]; var minfo={}; var minfometa={};
        if(line["Metal"]){
          if(line.Metalstamp)
          minfometa["metalstamp"]=line.Metalstamp;
          if(line.Finishing)
          minfometa["finish"]=line.Finishing;
          if(line["Metal Wt.(gm)"])
          minfometa["metalwt"]=line["Metal Wt.(gm)"]
          minfo ={"set":"metal","title":line.Metal,"meta":minfometa}
          infos.push(minfo);
        }

        for(i=1; i<16; i++){
          var sinfo={}; var sinfometa={};
          var Stone="Stone"+i; var Shape="Shape"+i; var Size="Size"+i+"(mm)"; var Quantity="Quantity"+i; var Weight="Weight"+i+"(ctw)";
          var Color="Color"+i; var Clarity="Clarity"+i;
          if(line[Stone]){
            if(line[Shape])
              sinfometa["stoneshape"]=line[Shape]
            if(line[Size])
              sinfometa["stonesize"]=line[Size]
            if(line[Quantity])
              sinfometa["stoneqty"]=line[Quantity]
            if(line[Weight])
              sinfometa["stonewt"]=line[Weight]
            if(line[Color])
              sinfometa["stonecolor"]=line[Color]
            if(line[Clarity])
              sinfometa["clarity"]=line[Clarity]
            sinfo={set:"stone", title:line[Stone], meta:sinfometa}
            infos.push(sinfo);
          }
        }
        var prices=[];var price={};
        if(line["JD Price"]){
          price={"code":"JD", "group":"default", "price":line["JD Price"], "mrp":line["MRP"] };
          prices.push(price);
        }
        if(line["QJC Price"]){
          price={"code":"QJC", "group":"default", "price":line["QJC Price"], "mrp":line["MRP"] };
          prices.push(price);
        }
        if(line["DS Price"]){
          price={"code":"DS", "group":"default", "price":line["DS Price"], "mrp":line["MRP"] };
          prices.push(price);
        }
        var medias=[]; var media={};
        //var mediapath= Product.app.get("mediapath");
        for(i=1; i<6; i++){
          var Image="Image"+i
          if(line[Image]){
            media={"type":"image", "path":"", "filename":line[Image], "title":line[Image],
            "tag":"", "seq":i-1, "activ": true}
            medias.push(media)
          }
        }
        var skus=[]; var sku={}; 
        var sizes=['5.00','5.50','6.00','6.50','7.00','7.25','7.50','7.75','8.00','8.25','9.00','9.50','10.00','10.25','10.50','11.00','11.50','12.00','12.50','13.00','14.00'];
        sizes.forEach(function(s){
          var size="size "+s;
          if(line[size]){
            sku={"code":line[size], "size":size, "instock":false, "updby":1, "activ": true};
            skus.push(sku);
          }
        })
        
        return Product.upsert(product, function(error, product) {
          if (error) {
            return done(error);
          } else {
            infos.forEach(function(info){
              product.infos.create(info, function(err,info){
                if(err) console.log(err)
              })
            });
            prices.forEach(function(price){
              product.prices.create(price, function(err,p){
                if(err) console.log(err)
              })
            })
            medias.forEach(function(media){
              product.media.create(media, function(err,m){
                if(err) console.log(err)
              })
            })
            skus.forEach(function(sku){
              product.skus.create(sku, function(err,s){
                if(err) console.log(err)
              })
            })
            result={"ref":product.code, "id":product.id, "msg":"success"}
            return done(null, result);
          }
        });
      });
    },
    updatePrice: function(line, uploadData, done){
      var msrp=""; var map="";
      var priceId=[];
      if(line.MSRP)
        msrp=line.MSRP;
      if(line.MAP)
        map=line.MAP
      return Product.findOne({where:{code: line.productcode}}, function(err,p){
        if(err) return done(err);
        if(!p){
          var err= new Error("product code is not valid");
          err.status = 422;
          return done(err);
        }else{
          if(line.QJ){
            p.prices.findOne({"where":{"code":"QJC"}}, function(err,pr){
              if(err) return done(err);
              if(pr){
                pr.updateAttributes({"price":line.QJ, "mrp":msrp}, function(err){
                  if(err) return done(err);
                  else priceId.push({"priceId":pr.id,"code":pr.code});
                })
              }else{
                var prObj={"code":"QJC","group":"default","price":line.QJ,"mrp":msrp,"productId":p._id};
                p.prices.create(prObj, function(err,price){
                  if(err) return done(err);
                  else priceId.push({"priceId":price.id,"code":price.code});
                })
              }
            })
          }
          if(line.OL){
            p.prices.findOne({"where":{"code":"JD"}}, function(err,pr){
              if(err) return done(err);
              if(pr){
                pr.updateAttributes({"price":line.OL, "mrp":msrp, "map":map}, function(err){
                  if(err) return done(err);
                  else priceId.push({"priceId":pr.id,"code":pr.code});
                })
              }else{
                var prObj={"code":"JD","group":"default","price":line.OL,"mrp":msrp,"productId":p._id};
                if(line.MAP) prObj["map"]=line.MAP;
                p.prices.create(prObj, function(err,price){
                  if(err) return done(err);
                  else priceId.push({"priceId":price.id,"code":price.code});
                })
              }
            })
          }
          if(line.DS){
            p.prices.findOne({"where":{"code":"DS"}}, function(err,pr){
              if(err) return done(err);
              if(pr){
                pr.updateAttributes({"price":line.DS, "mrp":msrp}, function(err){
                  if(err) return done(err);
                  else priceId.push({"priceId":pr.id,"code":pr.code});
                })
              }else{
                var prObj={"code":"DS","group":"default","price":line.DS,"mrp":msrp,"productId":p._id};
                p.prices.create(prObj, function(err,price){
                  if(err) return done(err);
                  else priceId.push({"priceId":price.id,"code":price.code});
                })
              }
            })
          }
        }
        if(line.costprice){
          var pmeta=p.meta;
          pmeta["costprice"]=Number(line.costprice);
          p.updateAttributes({"meta":pmeta}, function(err){
            if(err) return done(err);
          })
        }
        //Todo: Need to make it more efficient
        setTimeout(function () {
          result={"ref":p.code, "id":priceId, "msg":"success"};
          return done(null, result);
        }, 500);
      })
    },
    rejectLine: function(columnName, cellData, customErrorMessage, callback) {
      var err = new Error("Unprocessable entity in column " + columnName + " where data = " + cellData + " : " + customErrorMessage);
      err.status = 422;
      return callback(err);
    } 
  }
};
