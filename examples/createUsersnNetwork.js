var uuid = require('uuid');
var Promise = require('bluebird');
var ThinkTransaction = require('../thinkTransaction');
var transOptions = {
  timeout: 30 //timeout the transaction if it couldnt complete within this time window
};
var johnsId = uuid.v4(), rajasId = uuid.v4();
ThinkTransaction.begin(transOptions)
.then(function(trans) {
  //Create User's John and Raja into Profile Collection (in parallel)
  Promise.all([
    trans.op.insert({
      Profile : {
        id : johnsId, //REQUIRED : You will need to explicity pass id value along with other attributes of the document
        type: "User",
        firstName : "John",
        lastName : "K"
      }
    }),
    trans.op.insert({
      Profile : {
        id : rajasId, //REQUIRED : You will need to explicity pass id value along with other attributes of the document
        type: "User",
        firstName : "Raja",
        lastName : "M"
      }
    }),
  ])
  .then(function(results){
    //after both John and Raja have been created in Profile, make them as connections in ProfileNetwork Collection
    //Make Raja as Johns connection - John is now following Raja
    return trans.op.insert({
      ProfileNetwork : {
        id : uuid.v4(), //REQUIRED : You will need to explicity pass id value along with other attributes of the document
        profileId: johnsId,
        referencesProfileId : rajasId
      }
    }).then(function(result){
      //lets also make Raja follow John
      return trans.op.insert({
        ProfileNetwork : {
          id : uuid.v4(), //REQUIRED : You will need to explicity pass id value along with other attributes of the document
          profileId: rajasId,
          referencesProfileId : johnsId
        }
      });
    })
  })
  .then(function(results){
    console.log('create Users commit handler');
    trans.commit().then(function(result){
      console.log('commit complete');
      console.log(result);
    })
  })
  .catch(function(err){
    console.log('create Users catch handler');
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
