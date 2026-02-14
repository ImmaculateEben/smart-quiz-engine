// Quiz Data - Smart Quiz Engine
// Dynamic subjects and questions managed by admin

// Default quiz codes with subject assignments
const DEFAULT_CODES = [
    { code: 'EXAM2024', active: true, createdAt: '2024-01-01', used: false, subjects: ['English', 'Mathematics', 'Physics', 'Chemistry'], duration: 60, questionsPerSubject: 5, allowReview: true },
    { code: 'TEST123', active: true, createdAt: '2024-01-15', used: false, subjects: ['English', 'Mathematics'], duration: 30, questionsPerSubject: 5, allowReview: true },
    { code: 'QUIZ456', active: false, createdAt: '2024-02-01', used: false, subjects: [], duration: 30, questionsPerSubject: 5, allowReview: true }
];

// Default subjects
const DEFAULT_SUBJECTS = [
    { name: 'English', questions: [], createdAt: new Date().toISOString() },
    { name: 'Mathematics', questions: [], createdAt: new Date().toISOString() },
    { name: 'Physics', questions: [], createdAt: new Date().toISOString() },
    { name: 'Chemistry', questions: [], createdAt: new Date().toISOString() }
];

// Default questions for each subject
const DEFAULT_QUESTIONS = {
    English: [
        { id: 'eng-1', question: 'Choose the correct spelling:', options: ['Accomodation', 'Accommodation', 'Acommodation', 'Acomodation'], correctAnswer: 1, difficulty: 'easy' },
        { id: 'eng-2', question: 'The teacher asked the students to _____ their homework.', options: ['do', 'make', 'perform', 'execute'], correctAnswer: 0, difficulty: 'easy' },
        { id: 'eng-3', question: 'Which sentence is correct?', options: ['She is more smarter than her brother.', 'She is smarter than her brother.', 'She is most smarter than her brother.', 'She is smart than her brother.'], correctAnswer: 1, difficulty: 'easy' },
        { id: 'eng-4', question: 'Choose the synonym of "benevolent":', options: ['Cruel', 'Kind', 'Angry', 'Sad'], correctAnswer: 1, difficulty: 'medium' },
        { id: 'eng-5', question: 'The word "ephemeral" means:', options: ['Permanent', 'Lasting forever', 'Short-lived', 'Very important'], correctAnswer: 2, difficulty: 'hard' },
        { id: 'eng-6', question: 'Identify the antonym of "ancient":', options: ['Old', 'Historic', 'Modern', 'Antique'], correctAnswer: 2, difficulty: 'easy' },
        { id: 'eng-7', question: 'She _____ to the market yesterday.', options: ['go', 'goes', 'went', 'going'], correctAnswer: 2, difficulty: 'easy' },
        { id: 'eng-8', question: 'Which of these is a collective noun?', options: ['Team', 'Book', 'House', 'Water'], correctAnswer: 0, difficulty: 'medium' },
        { id: 'eng-9', question: 'The doctor gave _____ advice to the patient.', options: ['an', 'a', 'the', 'no article'], correctAnswer: 1, difficulty: 'medium' },
        { id: 'eng-10', question: 'Choose the correct plural of "child":', options: ['Childs', 'Children', 'Childrens', 'Childern'], correctAnswer: 1, difficulty: 'easy' },
        { id: 'eng-11', question: 'The concert was _____ than I expected.', options: ['good', 'better', 'best', 'more good'], correctAnswer: 1, difficulty: 'medium' },
        { id: 'eng-12', question: 'Which figure of speech is "The world is a stage"?', options: ['Simile', 'Metaphor', 'Personification', 'Hyperbole'], correctAnswer: 1, difficulty: 'hard' }
    ],
    Mathematics: [
        { id: 'math-1', question: 'What is 15% of 200?', options: ['25', '30', '35', '40'], correctAnswer: 1, difficulty: 'easy' },
        { id: 'math-2', question: 'Simplify: 3(x + 4) - 2(x - 1)', options: ['x + 14', 'x + 10', '5x + 14', 'x + 2'], correctAnswer: 0, difficulty: 'medium' },
        { id: 'math-3', question: 'If x² = 64, what is x?', options: ['8', '-8', '8 or -8', '4'], correctAnswer: 2, difficulty: 'easy' },
        { id: 'math-4', question: 'Calculate: √144 + √169', options: ['25', '27', '23', '21'], correctAnswer: 2, difficulty: 'easy' },
        { id: 'math-5', question: 'What is the value of 2³ × 2²?', options: ['4⁵', '2⁵', '4⁶', '2⁶'], correctAnswer: 1, difficulty: 'medium' },
        { id: 'math-6', question: 'Solve: 3x - 7 = 2x + 5', options: ['x = 12', 'x = -12', 'x = 2', 'x = -2'], correctAnswer: 0, difficulty: 'easy' },
        { id: 'math-7', question: 'What is the area of a circle with radius 7cm? (Use π = 22/7)', options: ['154 cm²', '144 cm²', '164 cm²', '134 cm²'], correctAnswer: 0, difficulty: 'medium' },
        { id: 'math-8', question: 'Factorize: x² - 9', options: ['(x-3)(x-3)', '(x-3)(x+3)', '(x+3)(x+3)', '(x-1)(x+9)'], correctAnswer: 1, difficulty: 'easy' },
        { id: 'math-9', question: 'What is the sum of angles in a triangle?', options: ['90°', '180°', '270°', '360°'], correctAnswer: 1, difficulty: 'easy' },
        { id: 'math-10', question: 'If y varies directly as x, and y = 12 when x = 4, find y when x = 10.', options: ['30', '20', '25', '35'], correctAnswer: 0, difficulty: 'medium' },
        { id: 'math-11', question: 'Calculate: (-5) × (-3) × (-2)', options: ['-30', '30', '-10', '10'], correctAnswer: 0, difficulty: 'medium' },
        { id: 'math-12', question: 'What is the derivative of 3x² + 2x?', options: ['6x + 2', '3x + 2', '6x² + 2x', '6 + 2'], correctAnswer: 0, difficulty: 'hard' }
    ],
    Physics: [
        { id: 'phy-1', question: 'What is the SI unit of force?', options: ['Joule', 'Watt', 'Newton', 'Pascal'], correctAnswer: 2, difficulty: 'easy' },
        { id: 'phy-2', question: 'Which of these is a vector quantity?', options: ['Mass', 'Time', 'Velocity', 'Temperature'], correctAnswer: 2, difficulty: 'easy' },
        { id: 'phy-3', question: 'The first law of motion is also known as:', options: ['Law of acceleration', 'Law of inertia', 'Law of action and reaction', 'Law of gravity'], correctAnswer: 1, difficulty: 'medium' },
        { id: 'phy-4', question: 'What is the speed of light in vacuum?', options: ['3 × 10⁶ m/s', '3 × 10⁸ m/s', '3 × 10⁷ m/s', '3 × 10⁵ m/s'], correctAnswer: 1, difficulty: 'easy' },
        { id: 'phy-5', question: 'Which color of light has the longest wavelength?', options: ['Violet', 'Blue', 'Red', 'Green'], correctAnswer: 2, difficulty: 'medium' },
        { id: 'phy-6', question: 'What is the formula for kinetic energy?', options: ['KE = mv', 'KE = ½mv²', 'KE = mgh', 'KE = mv²'], correctAnswer: 1, difficulty: 'easy' },
        { id: 'phy-7', question: 'A force of 10N acts on a body for 3 seconds. What is the impulse?', options: ['30 Ns', '3.33 Ns', '13 Ns', '7 Ns'], correctAnswer: 0, difficulty: 'medium' },
        { id: 'phy-8', question: 'Which of these is not a form of energy?', options: ['Heat', 'Light', 'Force', 'Sound'], correctAnswer: 2, difficulty: 'medium' },
        { id: 'phy-9', question: 'What is the unit of electrical resistance?', options: ['Volt', 'Ampere', 'Ohm', 'Watt'], correctAnswer: 2, difficulty: 'easy' },
        { id: 'phy-10', question: "According to Ohm's Law, V =", options: ['IR', 'I/R', 'R/I', 'I + R'], correctAnswer: 0, difficulty: 'easy' },
        { id: 'phy-11', question: 'What type of lens is used to correct myopia?', options: ['Convex', 'Concave', 'Bifocal', 'Plano'], correctAnswer: 1, difficulty: 'hard' },
        { id: 'phy-12', question: 'The work done is zero when the force is:', options: ['Perpendicular to displacement', 'Parallel to displacement', 'In the direction of displacement', 'Opposite to displacement'], correctAnswer: 0, difficulty: 'medium' }
    ],
    Chemistry: [
        { id: 'chem-1', question: 'What is the chemical symbol for gold?', options: ['Go', 'Gd', 'Au', 'Ag'], correctAnswer: 2, difficulty: 'easy' },
        { id: 'chem-2', question: 'Which gas is released when an acid reacts with a metal?', options: ['Oxygen', 'Nitrogen', 'Hydrogen', 'Carbon dioxide'], correctAnswer: 2, difficulty: 'easy' },
        { id: 'chem-3', question: 'What is the pH of a neutral solution?', options: ['0', '7', '14', '1'], correctAnswer: 1, difficulty: 'easy' },
        { id: 'chem-4', question: 'Which of these is a noble gas?', options: ['Oxygen', 'Nitrogen', 'Helium', 'Chlorine'], correctAnswer: 2, difficulty: 'easy' },
        { id: 'chem-5', question: 'What is the atomic number of Carbon?', options: ['6', '12', '8', '14'], correctAnswer: 0, difficulty: 'easy' },
        { id: 'chem-6', question: 'Which type of bond involves sharing of electrons?', options: ['Ionic bond', 'Covalent bond', 'Metallic bond', 'Hydrogen bond'], correctAnswer: 1, difficulty: 'medium' },
        { id: 'chem-7', question: 'What is the chemical formula for water?', options: ['H₂O', 'CO₂', 'NaCl', 'O₂'], correctAnswer: 0, difficulty: 'easy' },
        { id: 'chem-8', question: 'Which element has the highest electronegativity?', options: ['Oxygen', 'Nitrogen', 'Fluorine', 'Chlorine'], correctAnswer: 2, difficulty: 'hard' },
        { id: 'chem-9', question: 'What is the process by which plants make food?', options: ['Respiration', 'Photosynthesis', 'Fermentation', 'Combustion'], correctAnswer: 1, difficulty: 'easy' },
        { id: 'chem-10', question: 'Which acid is found in vinegar?', options: ['Citric acid', 'Acetic acid', 'Hydrochloric acid', 'Sulfuric acid'], correctAnswer: 1, difficulty: 'medium' },
        { id: 'chem-11', question: 'What is the oxidation state of oxygen in most compounds?', options: ['+1', '-1', '-2', '0'], correctAnswer: 2, difficulty: 'medium' },
        { id: 'chem-12', question: 'Which of these is a radioactive element?', options: ['Uranium', 'Iron', 'Copper', 'Zinc'], correctAnswer: 0, difficulty: 'medium' }
    ]
};

// Initialize subjects with default questions
function initializeDefaultData() {
    const storedSubjects = localStorage.getItem('quizSubjects');
    if (!storedSubjects) {
        // Initialize with default subjects and questions
        const initialSubjects = DEFAULT_SUBJECTS.map(sub => {
            const subjectQuestions = DEFAULT_QUESTIONS[sub.name] || [];
            return {
                name: sub.name,
                questions: subjectQuestions,
                createdAt: sub.createdAt
            };
        });
        localStorage.setItem('quizSubjects', JSON.stringify(initialSubjects));
    }
}

// Export
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { DEFAULT_CODES, DEFAULT_SUBJECTS, DEFAULT_QUESTIONS, initializeDefaultData };
}
