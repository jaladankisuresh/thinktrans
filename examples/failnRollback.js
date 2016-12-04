var uuid = require('uuid');
var ThinkTransaction = require('../thinkTransaction');

let timsUId = '5dd7767b-859b-43f1-a554-ea3913fff651'; //dummy id which does not exist in the db
//Fail and rollback transaction as we try Updating User Tim's lastName who doesnt exist in our Profile Collection
ThinkTransaction.begin({timeout: 30 })
.then(function(trans) {
  Promise.all([
    // Group Bangalore Hub will not be created as the 2nd statement in this transaction throws a "No such document exists" exception
    trans.op.insert({
      Profile : {
        id : uuid.v4(), //REQUIRED : You will need to explicity pass id value along with other attributes of the document
        type: "Group",
        firstName : "Bangalore Hub",
        lastName : "Koramangala"
      }
    }),
    //This operation should fail with "No such document exists" exception, when you dont have
    // record with id "7307a001-5051-41be-857d-fbe64a98cb5c" in Profile Collection
    trans.op.update({
      Profile : {
        set :{lastName:  "Washington"},
        where : {id: "7307a001-5051-41be-857d-fbe64a98cb5c", type : "User"}
      }
    })
  ])
  .then(function(results){
    console.log('update commit handler');
    trans.commit().then(function(result){
      console.log('commit complete');
      console.log(result);
    })
  })
  .catch(function(err){
    console.log('update catch handler');
    console.log(err);
    trans.rollback().then(function(result){
      console.log('rollback complete');
      console.log(result);
    });
  });
});
