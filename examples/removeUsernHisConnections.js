var uuid = require('uuid');
var Promise = require('bluebird');
var ThinkTransaction = require('../thinkTransaction');
var thinky = require('../configurations/thinky');
var r = thinky.r;
var transOptions = {
  timeout: 30 //timeout the transaction if it couldnt complete within this time window
};
let rajasUId = 'fb0279f6-d2b4-4947-8786-5c1464285735';

//Remove User Raja's connections from ProfileNetwork and remove him from Profile Collection (in parallel)
// You dont have to worry about sequencing as all operations execute in the transaction mode
ThinkTransaction.begin(transOptions)
.then(function(trans) {
  Promise.all([
    //delete User Raja from Profile collection
    trans.op.delete({
      Profile : {
          where :{id : rajasUId}
      }
    }),
    //Remove all the connections for User Raja from ProfileNetwork
    //This may not be the best of the examples to illustrate efficient DB operation, as we are deleting documents by id (primary key) in a loop.
        //Currently this is a limtation with this transaction library with all DML operations expecting primary key.
    r.table('ProfileNetwork').getAll(rajasUId, {index: 'profileId'}).run()
    .then(function(results){
      // In this scenario, Deletions on the ProfileNetwork involve multiple delete commands, but the commands execute in parallel
      return Promise.map(results, function(document){
        return trans.op.delete({
          ProfileNetwork : {
            where :{id : document.id, profileId : rajasUId}
          }
        });
      });
    })
  ])
  .then(function(results){
    console.log('Remove User n his connections commit handler');
    trans.commit().then(function(result){
      console.log('commit complete');
      console.log(result);
    })
  })
  .catch(function(err){
    console.log('Remove User n his connections catch handler');
    console.log(err);
    trans.rollback().then(function(result){
      console.log('rollback complete');
      console.log(result);
    });
  });
})
.catch(function(err){
  console.log('couldn\'t begin transaction');
  console.log(err);
});
