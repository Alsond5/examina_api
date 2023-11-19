import express from "express"
const app = express()

import { MerkleMap, Poseidon, Field, Struct, PublicKey, PrivateKey, Signature } from "o1js"
import { db, auth } from "./firebase.js"
import { doc, getDoc, setDoc, collection, getDocs, addDoc, query, where } from "firebase/firestore"

app.use(express.json()); // JSON verilerini işlemek için
app.use(express.urlencoded({ extended: true }));

const map_answers = new MerkleMap()
const map_user_answers = new MerkleMap()

app.post("/api/create/exam", async (req, res) => {
    if(!req.body) {
        return res.status(500).send("INVALID PARAMETERS")
    }

    const public_address = req.body.address

    const doc_ref = collection(db, "exams")

    const json_exam = {
        "title": req.body.title,
        "start_date": req.body.start_date,
        "created_by": public_address,
        "end_date": req.body.end_date,
    }

    const data = await addDoc(
        doc_ref,
        json_exam,
    )

    const exam_id = data.id

    const questions_ref = collection(db, "questions")

    json_exam["questions"] = []

    req.body.questions.forEach(async (element) => {
        const json_question = {
            question: element.question,
            options: element.options,
            exam: doc(db, "exams/" + exam_id)
        }
        
        await addDoc(questions_ref, json_question)

        json_exam["questions"].push(json_question)
    })

    const value = Buffer.from(JSON.stringify(json_exam), 'utf-8').toString("hex")
    const hash = Poseidon.hash(Field.toFields(Field(BigInt("0x" + value))))

    res.json({exam_hash: hash})
})

app.post("/api/submit", async (req, res) => {
    if(!req.body) {
        return res.status(500).send("INVALID PARAMETERS")
    }

    const public_address = req.body.address
    const exam_id = req.body.exam_id

    const exam_ref = doc(db, "exams", exam_id)
    const exam = await getDoc(exam_ref)

    if (exam.exists()) {
        const exam_end_date = new Date(exam.data().end_date)

        const today = new Date()

        if (today > exam_end_date) {
            return res.status(500).send("exam time has expired")
        }
    }
    else {
        return res.status(500).send("no quiz with this id found")
    }

    const user_answers = req.body.user_answers

    const k = Buffer.from(public_address + exam_id).toString("hex")

    const pk = Poseidon.hash(Field.toFields(Field(BigInt("0x" + k)))).toString()

    const doc_ref = doc(db, "users", pk)

    const user = {
        exam: doc(db, "exams/" + exam_id),
        answers: user_answers
    }

    await setDoc(
        doc_ref,
        user
    )

    const key = Buffer.from(public_address + exam_id, 'utf-8').toString("hex")
    const value = Buffer.from(JSON.stringify(user), 'utf-8').toString("hex")

    console.log(value)

    const hash = Poseidon.hash(Field.toFields(Field(BigInt(parseInt(key, 16)))))

    map_user_answers.set(hash, Field(BigInt("0x" + value)))

    res.json({message: "your exam has been successfully recorded", witness: map_user_answers.getWitness(hash)})
})

app.post("/api/get/answers_witnesses", (req, res) => {
    if(!req.body) {
        return res.status(500).send("INVALID PARAMETERS")
    }

    const public_address = req.body.address
    const exam_id = req.body.exam_id

    const key = Buffer.from(public_address + exam_id, 'utf-8').toString("hex")

    const hash = Poseidon.hash(Field.toFields(Field(BigInt(parseInt(key, 16)))))

    const id = Buffer.from(exam_id, 'utf-8').toString("hex")

    const user_answers = map_user_answers.getWitness(hash)
    const answers = map_answers.getWitness(Field(BigInt(parseInt(id, 16))))

    res.json({user_answers: user_answers, answers: answers})
})

app.get("/api/get/exam", async (req, res) => {
    if (!req.query || !req.query.id) {
        return res.status(500).send("INVALID PARAMETERS")
    }

    const id = req.query.id

    const doc_ref = doc(db, "exams", id)
    const exam = await getDoc(doc_ref)

    if (!exam.exists()) {
        return res.status(500).send("THERE IS NO EXAM WITH THIS ID")
    }

    const json_exam = {
        title: exam.data().title,
        created_by: exam.data().created_by,
        exam_id: exam.id,
        start_date: exam.data().start_date,
        end_date: exam.data().end_date,
        questions: []
    }

    const questions_ref = collection(db, "questions")
    const q = query(questions_ref, where("exam", "==", doc(db, "exams", id)))
    
    const questions = (await getDocs(q)).forEach(element => {
        json_exam["questions"].push({
            question: element.data().question,
            options: element.data().options
        })
    })

    res.json(json_exam)
})

app.get("/api/get/users_exams", async (req, res) => {
    if (!req.query || !req.query.address) {
        return res.status(500).send("INVALID PARAMETERS")
    }

    const address = req.query.address

    const doc_ref = doc(db, "users", address)
    const exam = await getDocs(doc_ref)

    if (!exam) {
        return res.status(500).send("THERE IS NO EXAM WITH THIS ID")
    }

    const exams = []

    exam.forEach(async element => {
        const json_exam = {
            title: element.data().title,
            created_by: element.data().created_by,
            exam_id: element.id,
            start_date: element.data().start_date,
            end_date: element.data().end_date,
            questions: []
        }
    
        const questions_ref = collection(db, "questions")
        const q = query(questions_ref, where("exam", "==", doc(db, "exams", element.id)))
        
        const questions = (await getDocs(q)).forEach(element => {
            json_exam["questions"].push({
                question: element.data().question,
                options: element.data().options
            })
        })

        exams.push(json_exam)
    })

    res.json({exams: exams})

})

app.get("/", (req, res) => {
    res.send("hello hackhaton!")
})

app.listen(80, () => console.log(`Running on http://localhost:80/`))