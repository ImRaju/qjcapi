module.exports = function(FileUpload) {
	FileUpload.disableRemoteMethod("upsert",true);
	FileUpload.disableRemoteMethod("create",true);
  FileUpload.disableRemoteMethod("exists",true);
  FileUpload.disableRemoteMethod("updateAttributes",false);
  FileUpload.disableRemoteMethod("__updateAttributes__errors",false);
  FileUpload.disableRemoteMethod('__updateById__errors',false);
  FileUpload.disableRemoteMethod("__create__errors",false);
  FileUpload.disableRemoteMethod("__destroy__errors",false);
  FileUpload.disableRemoteMethod("createChangeStream",true);
  FileUpload.disableRemoteMethod("createChangeStream__0",true);
  FileUpload.disableRemoteMethod('updateAll',true);
};
