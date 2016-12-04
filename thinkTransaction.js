var uuid = require('uuid');
var moment = require('moment');
var Promise = require('bluebird');
const EventEmitter = require('events');
var thinky = require('./configurations/thinky');
var r = thinky.r;

var ThinkTransaction = class ThinkTransaction extends EventEmitter {

  constructor (options) {
    super();
    let self = this;
    var opPromiseArr = [];
    this.options = Object.assign({}, {timeout: 30}, options);
    this.transactionId = uuid.v4();
    this.state = 'pending'; //initial state of the transaction
    this.startTimestamp = null;
    this.docsOpsArr = [];
    this.op = {
      insert : function(docArgs) {
        return Promise.try(function() {
          let table = Object.keys(docArgs)[0];
          let params = {
            operationId : uuid.v4(),
            table : table,
            operation : 'insert',
            args : docArgs[table]
          };
          self.docsOpsArr.push(params);
          return params;
        })
        .then(function(params) {
          let p = Promise.all([addOperationToTransactionLog(params), insertAsync(params)]);
          opPromiseArr.push(p);
          return p;
        })
        .catch(function(ex){
          console.log('exception while insert');
          self.state = 'beginTransError';
          throw ex;
        });

      },

      update : function(docArgs) {
        return Promise.try(function() {
          let table = Object.keys(docArgs)[0];
          let params = {
            operationId : uuid.v4(),
            table : table,
            operation : 'update',
            args : docArgs[table]
          };
          self.docsOpsArr.push(params);
          return params;
        })
        .then(function(params) {
          let p = Promise.all([addOperationToTransactionLog(params), updateAsync(params)]);
          opPromiseArr.push(p);
          return p;
        })
        .catch(function(ex){
          console.log('exception while update');
          self.state = 'beginTransError';
          throw ex;
        });

      },

      delete : function(docArgs) {
        return Promise.try(function() {
          let table = Object.keys(docArgs)[0];
          let params = {
            operationId : uuid.v4(),
            table : table,
            operation : 'delete',
            args : docArgs[table]
          };
          self.docsOpsArr.push(params);
          return params;
        })
        .then(function(params) {
          let p = Promise.all([addOperationToTransactionLog(params), deleteAsync(params)]);
          opPromiseArr.push(p);
          return p;
        })
        .catch(function(ex){
          console.log('exception while delete');
          self.state = 'beginTransError';
          throw ex;
        });
      }

    };
    this.settleAllOperations = function(){
      return Promise.all(opPromiseArr.map(function(opPromise) {
          return opPromise.reflect();
      }));
    };

    var insertAsync = function(params) {
      return Promise.try(function() {
        let uniqueFilter = JSON.parse(JSON.stringify(params.args));
        delete uniqueFilter.id;
        delete uniqueFilter.date //This applies to created or updated date fields;

        return uniqueFilter;
      })
      .then(function(uniqueFilter) {

        return r.table(params.table).filter({transactional : {lock : 'close'}}).map(
          r.branch(
          r.row('transactional')('transient')(0)('type').eq('replace'),
              r.row('transactional')('transient')(0)('data')('applied_val'),
          r.row('transactional')('transient')(0)('type').eq('add'),
              r.row('transactional')('transient')(0)('data')('new_val'),
          null
          )
        ).filter(uniqueFilter)
        .union(r.table(params.table).filter(uniqueFilter)).run()
        .then(function(result) {
          if(!ThinkTransaction.isEmptyorNull(result)) {
            let error = {
              type : 'ReqlDuplicateError',
              'short description' : 'similar document exists in the database',
              data : params
            };
            throw error;
          }

          let transactionDoc = {
            id : params.args.id,
            transactional : {
              lock: 'close',
              transient : [{
                data: {
                  old_val : null,
                  new_val : params.args
                },
                state: 'applied',
                type : 'add',
                transactionId : self.transactionId,
                operationId : params.operationId
              }]
            }
          };
          console.log('Insert Applied');
          return r.table(params.table).insert(transactionDoc).run();
        });

      });

    };

    var updateAsync = function(params) {
      return r.table(params.table).filter(params.args.where).run()
      .then(function(result) {
        if(ThinkTransaction.isEmptyorNull(result)) {
          let error = {
            type : 'ReqlNonExistenceError',
            'short description' : 'No such document exists in the database',
            data : params
          };
          throw error;
        }
        let document = result[0]; //result is an array of documents, but should only contain 1 document
        let whereExtn = {};
        Object.keys(params.args.set).forEach(function(key){
          if(document[key])  whereExtn[key] = document[key];
        });
        params.args.where = Object.assign({}, whereExtn, params.args.where);

        let transPendingTransientData = {
          data: {
            new_val: params.args.set
          },
          state : 'pending',
          type : 'change',
          transactionId : self.transactionId,
          operationId : params.operationId
        };
        let transDataWithLock = {
          lock: 'close',
          transient : [{
            data: {
              old_val : document,
              new_val : params.args.set,
              applied_val : Object.assign({}, document, params.args.set)
            },
            state: 'applied',
            type : 'change',
            transactionId : self.transactionId,
            operationId : params.operationId
          }]
        };

        return r.table(params.table).filter(params.args.where).nth(0)
        .update(
          r.branch(
            r.row.hasFields('transactional'),
            {transactional : {transient : r.row('transactional')('transient').append(transPendingTransientData)}},
            {transactional: transDataWithLock}
          ), {returnChanges: true}).run()
        .then(function(dbResponse){
          if(dbResponse.replaced == 0) {
              let error = {
                label : 'DocumentNotFound',
                description : 'No document found to update with the matching filter',
                params : params
              }
              console.log('No documents found to update');
              throw error;
          }

          let document = dbResponse.changes[0].new_val;
          if((document.transactional.transient[0].transactionId == self.transactionId)
              && (document.transactional.transient[0].operationId == params.operationId)){
            console.log('Update Applied');
            delete dbResponse.changes;
            return dbResponse;
          }
          else {
            console.log('Update Queued');
            return waitDbOperationForLockOpen(params, transPendingTransientData);
          }
        });
      });

    };

    var deleteAsync = function(params) {
      return r.table(params.table).filter(params.args.where).run()
      .then(function(result) {
        if(ThinkTransaction.isEmptyorNull(result)) {
          let error = {
            type : 'ReqlNonExistenceError',
            'short description' : 'No such document exists in the database',
            data : params
          };
          throw error;
        }
        let document = result[0]; //result is an array of documents, but should only contain 1 document

        let transPendingTransientData = {
          data: {
            new_val: null
          },
          state : 'pending',
          type : 'remove',
          transactionId : self.transactionId,
          operationId : params.operationId
        };
        let transDataWithLock = {
          lock: 'close',
          transient : [{
            data: {
              old_val : document,
              new_val : null
            },
            state: 'applied',
            type : 'remove',
            transactionId : self.transactionId,
            operationId : params.operationId
          }]
        };

        return r.table(params.table).filter(params.args.where).nth(0)
        .update(
          r.branch(
            r.row.hasFields('transactional'),
            {transactional : {transient : r.row('transactional')('transient').append(transPendingTransientData)}},
            {transactional: transDataWithLock}
          ), {returnChanges: true}).run()
        .then(function(dbResponse){
          if(dbResponse.replaced == 0) {
              let error = {
                label : 'DocumentNotFound',
                description : 'No document found to delete with the matching filter',
                params : params
              }
              console.log('No documents found to delete');
              throw error;
          }

          let document = dbResponse.changes[0].new_val;
          if((document.transactional.transient[0].transactionId == self.transactionId)
              && (document.transactional.transient[0].operationId == params.operationId)){
            console.log('Delete Applied');
            return document
          }
          else {
            console.log('Delete Queued');
            return waitDbOperationForLockOpen(params, transPendingTransientData);
          }
        });
      });
    };

    var addOperationToTransactionLog = function(params) {
      return r.table('Transaction').get(self.transactionId).update({data : r.row('data').append(params)}).run();
    };

    var waitDbOperationForLockOpen = function(params, transientData) {
      return new Promise(function (resolve, reject) {
        r.table(params.table).get(params.args.where.id).changes().run({cursor : true})
        .then(function(cursor) {
          let isWaitOver = false;
          cursor.each(function(err, doc) {
            if(err) {
              reject(err);
            }

            if((self.state !== 'pending') || (ThinkTransaction.isEmptyorNull(doc.new_val))) {
              self.removeListener('beginTransTimeout', onTransError);
              let err = {
                error : 'TransactionStateInvalid',
                description : 'Transaction State is not in pending state',
                args : params
              };
              return onTransError(err);
            }
            let document = doc.new_val;
            for (let key in params.args.where) {
              if(params.args.where.hasOwnProperty(key)) {
                if(params.args.where[key] != document[key]) {
                  self.removeListener('beginTransTimeout', onTransError);
                  let err = {
                    label : 'DocumentNotFound',
                    description : 'No document found with the matching filter',
                    params : params
                  }
                  console.log('No documents found, It could be that document has changed');
                  return onTransError(err);
                }
              }
            }

            if((document.transactional.lock == 'open')
                  && (document.transactional.transient[0].transactionId == self.transactionId)
                  && (document.transactional.transient[0].operationId == params.operationId)) {
              delete document.transactional;

              transientData.data.old_val = document;
              if(params.operation == 'update') {
                transientData.data.applied_val = Object.assign({}, document, params.args.set);
              }
              r.table(params.table).filter(params.args.where).nth(0)
              .update({
                transactional: { lock : 'close',
                    transient : r.row('transactional')('transient').changeAt(0, transientData)
                }
              }).run()
              .then(function(results){
                console.log('wait over, Db operation is complete');
                isWaitOver = true;
                resolve(results);
              })
              .finally(function(){
                cursor.close();
                self.removeListener('beginTransTimeout', onTransError);
              });
            }
          });

          let onTransError = function(error) {
            if(!isWaitOver) {
              cursor.close();
              reject(error);
            }
          };
          self.once('beginTransTimeout', onTransError);
        });
      });
    };

  }

  static isEmptyorNull(obj) {
    if(!obj) return true;
    if(obj.constructor === Array){
      return obj.length === 0;
    }
    if(obj.constructor === Object){
      return Object.keys(obj).length === 0;
    }
    return false;
  }

  static begin(options) {
    return r.tableList().contains('Transaction').run()
    .then(function(result){
      if(result) {
        return true;
      }
      else {
        console.log('creating Transaction table');
        return r.tableCreate('Transaction').run()
        .then(function(result){
          console.log('Transaction table created');
          return true;
        });
      }
    })
    .then(function(success){
      var trans = new ThinkTransaction(options);
      return trans.beginTrans()
      .then(function(){
        return trans;
      });
    })
  }

  beginTrans() {

    let self = this; //this is workaround to fix issue with accessing (this) object inside sub-funtions
    let isDone = false;
    self.startTimestamp = moment().toISOString();
    setTimeout(function(){
      let error = {
        type : 'beginTransTimeout',
        'short description' : 'Transaction has Timedout'
      };
      self.state = 'beginTimeout';
      self.emit('beginTransTimeout', error);
    }, self.options.timeout * 1000);

    return Promise.try(function() {
      let transRecord = {
        id : self.transactionId,
        data : [],
        state : 'pending',
        timeout : self.options.timeout,
        created : self.startTimestamp
      };
      self.state = 'pending';
      return transRecord;
    })
    .then(function(transRecord) {
      return r.table('Transaction').insert(transRecord).run();
    });

  }

  commit() {
    let isDone = false, self = this;
    self.state = 'commitInitiated';

    var commitDbOperation = function(params) {
      let whereFilter = (params.operation == 'insert') ? {id : params.args.id } : params.args.where;
      return r.table(params.table).filter(whereFilter).run()
      .then(function(results) {
        let error = {
          type : 'ReqlNonExistenceError',
          'short description' : 'No such document with matching transaction details exists in the database',
          data : params
        };
        if(ThinkTransaction.isEmptyorNull(results)) throw error;
        let document = results[0];
        if(document.transactional.lock != 'close') throw error;
        if(document.transactional.transient[0].transactionId != self.transactionId) throw error;
        if(document.transactional.transient[0].operationId != params.operationId) throw error;
        switch(params.operation) {
          case 'insert' :
            console.log('commit insert');
            return r.table(params.table).get(params.args.id).replace(document.transactional.transient[0].data.new_val).run();
          case 'update' :
            console.log('commit update');
            return r.table(params.table).filter(params.args.where)
            .replace(
              r.js(`
                (function(document){
                  'use strict';
                  if( (document === null) || (Object.keys(document).length === 0) )
                    return null;
                  else if(document.transactional.transient.length == 1)
                    return document.transactional.transient[0].data.applied_val;
                  else {
                    let primaryData = JSON.parse(JSON.stringify(document.transactional.transient[0].data.applied_val));
                    document.transactional.transient.splice(0, 1);
                    return Object.assign({}, primaryData,
                          {transactional : {lock : 'open', transient : document.transactional.transient}});
                  }
                })`
              ), { nonAtomic: true }
            ).run();
            break;
          case 'delete' :
            return r.table(params.table).filter(params.args.where).delete().run();
          default :
            // throw exception
            throw('Object Not Found');
        }
      });
    };

    var commitTransaction = function(){
      return Promise.map(self.docsOpsArr, function(docParams){
        return commitDbOperation(docParams);
      });
    };

    var onTransactionCommited = function(){
      self.state = 'commit';
      return r.table('Transaction').get(self.transactionId).update({state : 'commit'}).run();
    };

    return self.settleAllOperations()
    .then(function(results){
      return commitTransaction()
      .then(function(){
        return onTransactionCommited()
        .then(function(result){
          isDone = true;
          return result;
        });
      });
    });

  }

  rollback() {
    let self = this;
    self.state = 'rollbackInitiated';

    var revertDbOperation = function(params) {
      switch(params.operation) {
        case 'insert' :
          console.log('undo insert');
          return r.table(params.table).get(params.args.id).run()
          .then(function(document) {
            if(ThinkTransaction.isEmptyorNull(document)) return;
            if((typeof document.transactional !== 'object') || (Object.keys(document.transactional).length === 0)) return;
            /* Do the below validation check make sense, Can they occur
            let error = {
              type : 'ReqlNonExistenceError',
              'short description' : 'No such document with matching transaction details exists in the database',
              data : params
            };*/
            if(document.transactional.lock != 'close') return;
            if(document.transactional.transient[0].transactionId != self.transactionId) return;
            if(document.transactional.transient[0].operationId != params.operationId) return;
            return r.table(params.table).get(params.args.id).delete().run();
          });
          break;
        case 'update' :
          console.log('undo update; neglect the undo delete that shows below');
        case 'delete' :
          console.log('undo delete');
          r.table(params.table).get(params.args.where.id).run()
          .then(function(document) {
            if(ThinkTransaction.isEmptyorNull(document)) return;

            let index = 0;
            for(index = 0; index < document.transactional.transient.length; index++) {
              if((document.transactional.transient[index].transactionId == self.transactionId)
                  && (document.transactional.transient[index].operationId == params.operationId)) break;
            }
            if(index == document.transactional.transient.length) return;
            let docReplaceJs = `
              (function(document){
                'use strict';
                if((document === null) || (Object.keys(document).length === 0) ||
                    (typeof document.transactional !== 'object') || (Object.keys(document.transactional).length === 0)) {
                  return document;
                }
                else if(document.transactional.transient.length == 1) {
                  delete document.transactional;
                  return document;
                }
                else {
                  let index = 0;
                  for(index = 0; index < document.transactional.transient.length; index++) {
                    if((document.transactional.transient[index].transactionId == '${self.transactionId}')
                        && (document.transactional.transient[index].operationId == '${params.operationId}')) break;
                  }
                  document.transactional.transient.splice(index, 1);
                  return document;
                }
              })`;
            return r.table(params.table).filter(params.args.where.id)
            .replace(
              r.js(docReplaceJs), { nonAtomic: true }
            ).run();
          });
          break;
        default :
          // throw exception
          throw('Object Not Found');
      }
    };

    var rollbackTransaction = function(){
      return Promise.map(self.docsOpsArr, function(docParams){
        return revertDbOperation(docParams);
      });
    };

    var onTransactionRolledback = function() {
      self.state = 'rollback';
      return r.table('Transaction').get(self.transactionId).update({state : 'rollback'}).run();
    };

    return self.settleAllOperations()
    .then(function(){
      return rollbackTransaction()
      .then(function(){
        return onTransactionRolledback();
      });
    });
  }

}

module.exports = ThinkTransaction;
