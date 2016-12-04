# thinktrans
Declarative javascript library for RethinkDB supporting Atomic transactions

This Promised based Micro Library can run multiple DML operations in ATOMIC mode keeping the data in READ COMMITED isolation level. This is not be mistaken with default READ UNCOMMITTED isolation in which [ReThinkDB](https://www.rethinkdb.com/faq/) runs. It doesnt override ReThinkDB read isolation, but does promise READ COMMITED isolation just for the data set particapting in the transaction context. Its semantics are inspired by [sequelize](https://github.com/sequelize/sequelize), a javascript based SQL ORM with transaction support. 

# Usage

All the DML operations INSERT, UPDATE AND DELETE return promisable objects, so they are thenable and chainable with other promisable objects including other DML transactional operations or anything promisable. It expects all your transactional operations to be and include PRIMARY KEY (it looks for primary key with property "id"). This restriction may be relaxed during in the subsequent releases

#### Hello Me Example:

```javascript
//Insert New User into Profile Collection
ThinkTransaction.begin({timeout: 30})
.then(function(trans) {
  trans.op.insert({
    Profile : { // Profile is name of your collection in rethinkdb database
      id : uuid.v4(), //REQUIRED : You will need to explicity pass id value along with other attributes of the document
      type: "User",
      firstName : "John",
      lastName : "K"
    }
  })
  .then(function(results){ //On success, commit the transaction
    console.log('insert commit handler');
    trans.commit().then(function(result){
      console.log('commit complete');
      console.log(result);
    })
  })
  .catch(function(err){ //On failure, rollback the transaction
    console.log('insert catch handler');
    console.log(err);
    trans.rollback().then(function(result){
      console.log('rollback complete');
      console.log(result);
    });
  });
});
```

### Insert

```javascript
//returns a promise
trans.op.insert({
    Profile : { // Profile is name of your collection in rethinkdb database
      id : uuid.v4(), //REQUIRED : You will need to explicity pass id value along with other attributes of the document
      type: "User",
      firstName : "John",
      lastName : "K"
    }
  })
```  

### Update

```javascript
//returns a promise
trans.op.update({
    Profile : { //Profile is name of your collection in rethinkdb database
      set :{lastName:  "Kennedy"}, //By design, You could set any property of the document, including properties with deep structures.
                  //But, for now we have tested it only with simple flat properties
      where : {id: "7307a001-5051-41be-857d-fbe64a98cb5c", type : "User"} //This could be any js object you may pass to rethinkdb
                  // .filter() command. However, this library expects id (primary key on Profile collection) to be part of the filter.
                  // This limitation is to make determinstic selection on what you are trying to update, as other properties are bound to change
                  // from updates from other concurrent transactions
    }
  })
```  

### Delete


```javascript
//returns a promise
trans.op.delete({
    Profile : {
      where : {firstName : "John", lastName:  "Kennedy", type : "User"} //This could be any js object you may pass to rethinkdb
                  // .filter() command. However, this library expects id (primary key on Profile collection) to be part of the filter.
                  // This limitation is to make determinstic selection on what you are trying to delete, as other properties are bound to change
                  // from updates from other concurrent transactions
    }
  })
```  

### Grown-up Example

```javascript
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
```  
#### [More Examples Here](./examples)
for the complete working code and additional examples. These examples are using [bluebird](https://github.com/petkaantonov/bluebird) and [thinky](https://github.com/neumino/thinky) libraries. You may also choose to use rethinkdbdash, but make sure you change the references in the library to allow this library to reuse the same connection pool. 

# Contribute
You are welcome to do a pull request

# Roadmap
* Implement backend job that monitors the ReThinkDB database connection, and fails the transactions immediately when connection is lost.
  r.getPoolMaster().on('healthy', function(healthy) {
  });
* Side-by-side plug and play with [sequelize](https://github.com/sequelize/sequelize) SQL ORM library to support transactions cross living between SQL database like MySQL and RethinkDB.
* Support user friendly errors, currently it rethrows upstream errors AS IS
* And, ofcourse Issues/feedback coming from GitHub Issues 
https://github.com/jaladankisuresh/thinktrans/issues

# License
open sourced with [MIT](./License.md) license

