// Smart Quiz Engine - Main Application Logic
// State Machine Implementation

// ============================================
// STATE MACHINE
// ============================================
const AppState = {
    // Current state
    currentState: 'landing',
    
    // User data
    user: {
        fullName: '',
        email: '',
        phone: '',
        school: '',
        examCode: ''
    },
    
    // Quiz data
    selectedSubjects: [],
    questions: [],
    currentQuestionIndex: 0,
    userAnswers: [],
    scores: {},
    
    // Timer
    timer: null,
    timeRemaining: 0,
    isPaused: false,
    
    // Settings
    questionsPerSubject: 3, // Number of questions per subject
    
    // Subject-specific tracking
    currentSubject: null,
    currentSubjectIndex: 0,
    subjectQuestions: [],
    subjectsAnswered: {},
    timerStarted: false,
    allowReview: true,
    
    // Admin
    adminLoggedIn: false,
    codes: [],
    results: [],
    subjects: [],
    allQuestions: {},
    admins: []
};

// State Machine transitions
const StateMachine = {
    transitions: {
        'landing': ['login', 'adminLogin'],
        'login': ['codeVerification', 'landing'],
        'codeVerification': ['instructions', 'login'],
        'instructions': ['quiz', 'login'],
        'quiz': ['quizComplete', 'quiz'],
        'quizComplete': ['review', 'landing'],
        'review': ['quizComplete', 'landing'],
        'adminLogin': ['adminDashboard', 'landing'],
        'adminDashboard': ['adminLogin', 'landing']
    },
    
    canTransition(from, to) {
        return this.transitions[from]?.includes(to) || false;
    },
    
    transition(to) {
        const from = AppState.currentState;
        if (this.canTransition(from, to)) {
            AppState.currentState = to;
            return true;
        }
        console.warn(`Cannot transition from ${from} to ${to}`);
        return false;
    }
};

// ============================================
// SCREEN MANAGEMENT
// ============================================
function showScreen(screenId) {
    // Hide all screens
    document.querySelectorAll('.screen').forEach(screen => {
        screen.classList.remove('active');
    });
    
    // Show target screen
    const targetScreen = document.getElementById(screenId);
    if (targetScreen) {
        targetScreen.classList.add('active');
    }
    
    // Hide user info on login screen
    if (screenId === 'loginScreen' || screenId === 'landingScreen') {
        document.getElementById('userInfo').style.display = 'none';
    }
    
    // Update state
    const stateMap = {
        'landingScreen': 'landing',
        'loginScreen': 'login',
        'codeVerificationScreen': 'codeVerification',
        'subjectSelectionScreen': 'subjectSelection',
        'instructionsScreen': 'instructions',
        'quizScreen': 'quiz',
        'quizCompleteScreen': 'quizComplete',
        'reviewScreen': 'review',
        'adminLoginScreen': 'adminLogin',
        'adminDashboardScreen': 'adminDashboard'
    };
    
    AppState.currentState = stateMap[screenId] || AppState.currentState;
}

// ============================================
// USER REGISTRATION & CODE VERIFICATION
// ============================================
function handleRegistration(event) {
    event.preventDefault();
    
    // Get form values
    AppState.user.fullName = document.getElementById('fullName').value.trim();
    AppState.user.email = document.getElementById('email').value.trim();
    AppState.user.phone = document.getElementById('phone').value.trim();
    AppState.user.school = document.getElementById('school').value.trim();
    AppState.user.examCode = document.getElementById('examCode').value.trim().toUpperCase();
    
    // Verify code
    verifyExamCode();
}

function verifyExamCode() {
    loadCodes();
    loadSubjects();
    
    const code = AppState.user.examCode;
    const foundCode = AppState.codes.find(c => c.code === code);
    
    if (foundCode && foundCode.active) {
        // Check if code validity period has expired
        const validityHours = foundCode.validityHours || 24;
        const createdAt = new Date(foundCode.createdAt);
        const now = new Date();
        const hoursPassed = (now - createdAt) / (1000 * 60 * 60);
        
        if (hoursPassed > validityHours) {
            document.getElementById('codeValid').style.display = 'none';
            document.getElementById('codeInvalid').style.display = 'block';
            document.querySelector('#codeInvalid h2').textContent = 'Code Expired';
            document.querySelector('#codeInvalid p').textContent = `This exam code was created ${Math.floor(hoursPassed)} hours ago and is no longer valid. Please contact your administrator for a new code.`;
            showScreen('codeVerificationScreen');
            return;
        }
        
        // Check if code has subjects assigned
        if (!foundCode.subjects || foundCode.subjects.length === 0) {
            document.getElementById('codeValid').style.display = 'none';
            document.getElementById('codeInvalid').style.display = 'block';
            document.querySelector('#codeInvalid h2').textContent = 'No Subjects Assigned';
            document.querySelector('#codeInvalid p').textContent = 'This exam code does not have any subjects assigned. Please contact your administrator.';
            showScreen('codeVerificationScreen');
            return;
        }
        
        // Set selected subjects from code
        AppState.selectedSubjects = foundCode.subjects;
        
        // Store duration from code
        AppState.examDuration = foundCode.duration || 30;
        
        // Store questions per subject from code
        AppState.questionsPerSubject = foundCode.questionsPerSubject || 5;
        
        // Store allow review setting
        AppState.allowReview = foundCode.allowReview !== false;
        
        // Save exam session to localStorage for persistence
        const examSession = {
            selectedSubjects: AppState.selectedSubjects,
            examDuration: AppState.examDuration,
            questionsPerSubject: AppState.questionsPerSubject,
            allowReview: AppState.allowReview
        };
        localStorage.setItem('examSession', JSON.stringify(examSession));
        
        // Update instructions with subjects info
        updateInstructionsWithSubjects();
        
        document.getElementById('codeValid').style.display = 'block';
        document.getElementById('codeInvalid').style.display = 'none';
        
        // Save user to localStorage
        localStorage.setItem('currentUser', JSON.stringify(AppState.user));
        
        // Show user name in header
        document.getElementById('userInfo').style.display = 'block';
        document.getElementById('userName').textContent = AppState.user.fullName;
        
        setTimeout(() => {
            showScreen('instructionsScreen');
        }, 1500);
    } else {
        document.getElementById('codeValid').style.display = 'none';
        document.getElementById('codeInvalid').style.display = 'block';
        document.querySelector('#codeInvalid h2').textContent = 'Invalid Code';
        document.querySelector('#codeInvalid p').textContent = 'The exam code you entered is invalid or has expired.';
    }
    
    showScreen('codeVerificationScreen');
}

function updateInstructionsWithSubjects() {
    const subjectsList = AppState.selectedSubjects.join(', ');
    const duration = AppState.examDuration || 30;
    const questionsPerSubject = AppState.questionsPerSubject || 5;
    
    // Update the time in instructions
    document.getElementById('totalTime').textContent = duration;
    
    // Find and update the subjects instruction
    const instructions = document.querySelectorAll('.instruction-item');
    if (instructions.length > 0) {
        // Add subjects info if not already there
        let subjectsInfo = document.getElementById('subjectsInfo');
        if (!subjectsInfo) {
            subjectsInfo = document.createElement('div');
            subjectsInfo.id = 'subjectsInfo';
            subjectsInfo.style.cssText = 'background: #e6fffa; padding: 10px; border-radius: 6px; margin-top: 10px;';
            subjectsInfo.innerHTML = `<strong>Subjects:</strong> ${subjectsList}<br><strong>Duration:</strong> ${duration} minutes<br><strong>Questions/Subject:</strong> ${questionsPerSubject}`;
            instructions[0].appendChild(subjectsInfo);
        } else {
            subjectsInfo.innerHTML = `<strong>Subjects:</strong> ${subjectsList}<br><strong>Duration:</strong> ${duration} minutes<br><strong>Questions/Subject:</strong> ${questionsPerSubject}`;
        }
    }
}

// ============================================
// SUBJECT SELECTION
// ============================================
function goToNextStep() {
    // Check if subjects are already selected
    if (AppState.selectedSubjects && AppState.selectedSubjects.length > 0) {
        // Update total time and go to instructions
        const totalMinutes = AppState.selectedSubjects.length * 7.5;
        document.getElementById('totalTime').textContent = Math.round(totalMinutes);
        showScreen('instructionsScreen');
    } else {
        // Go to subject selection
        showScreen('subjectSelectionScreen');
    }
}

// ============================================
function handleSubjectSelection() {
    const checkboxes = document.querySelectorAll('.subject-checkbox input:checked');
    AppState.selectedSubjects = Array.from(checkboxes).map(cb => cb.value);
    
    if (AppState.selectedSubjects.length === 0) {
        alert('Please select at least one subject');
        return;
    }
    
    // Show total time based on selected subjects
    const totalMinutes = AppState.selectedSubjects.length * 7.5; // 7.5 min per subject
    document.getElementById('totalTime').textContent = totalMinutes;
    
    showScreen('instructionsScreen');
}

// ============================================
// QUESTION PREPARATION
// ============================================
function prepareQuestions() {
    AppState.questions = [];
    AppState.userAnswers = [];
    AppState.scores = {};
    
    // Ensure we have subjects loaded
    if (AppState.subjects.length === 0) {
        loadSubjects();
    }
    
    // Initialize scores for each subject
    AppState.selectedSubjects.forEach(subject => {
        AppState.scores[subject] = {
            correct: 0,
            total: 0,
            questions: []
        };
    });
    
    // Get random questions for each selected subject
    AppState.selectedSubjects.forEach(subject => {
        const subjectQuestions = [...(AppState.allQuestions[subject] || [])];
        
        // Shuffle questions
        shuffleArray(subjectQuestions);
        
        // Take required number of questions - default to 5 if not set
        const questionsCount = AppState.questionsPerSubject || 5;
        const selectedQuestions = subjectQuestions.slice(0, questionsCount);
        
        // Add to main question array
        selectedQuestions.forEach((q, index) => {
            AppState.questions.push({
                ...q,
                subject: subject,
                subjectIndex: index + 1
            });
            
            AppState.scores[subject].total++;
            AppState.scores[subject].questions.push({
                questionId: q.id,
                userAnswer: null,
                isCorrect: false
            });
        });
    });
    
    // Initialize user answers and add global index to each question
    let globalIndex = 0;
    AppState.questions.forEach((q) => {
        AppState.userAnswers.push({
            questionId: q.id,
            selectedOption: null,
            subject: q.subject,
            globalIndex: globalIndex
        });
        q.globalIndex = globalIndex;
        globalIndex++;
    });
    
    // Update total questions display
    if (document.getElementById('totalQuestions')) {
        document.getElementById('totalQuestions').textContent = AppState.questions.length;
    }
}

// Fisher-Yates shuffle
function shuffleArray(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
}

// ============================================
// QUIZ START & TIMER
// ============================================
function startQuiz() {
    try {
        // Check if exam code has been verified
        if (!AppState.user.examCode) {
            alert('Please enter a valid exam code first.');
            showScreen('loginScreen');
            return;
        }
        
        // Check if subjects are selected
        if (!AppState.selectedSubjects || AppState.selectedSubjects.length === 0) {
            alert('Please select at least one subject.');
            showScreen('subjectSelectionScreen');
            return;
        }
        
        // Load questions
        loadSubjects();
        
        // Check if there are questions available
        let totalAvailableQuestions = 0;
        AppState.selectedSubjects.forEach(subject => {
            const subjectQuestions = AppState.allQuestions[subject] || [];
            totalAvailableQuestions += subjectQuestions.length;
        });
        
        if (totalAvailableQuestions === 0) {
            alert('No questions available for the selected subjects. Please contact your administrator to add questions.');
            return;
        }
        
        // Ensure we have duration
        const foundCode = AppState.codes.find(c => c.code === AppState.user.examCode);
        if (foundCode) {
            AppState.examDuration = foundCode.duration || 30;
        } else {
            AppState.examDuration = 30;
        }
        
        prepareQuestions();
        
        // Check if questions were prepared
        if (AppState.questions.length === 0) {
            alert('Not enough questions available. Please contact your administrator.');
            return;
        }
        
        // Use duration from code, default to 30 minutes
        const totalMinutes = AppState.examDuration;
        AppState.timeRemaining = totalMinutes * 60;
        AppState.isPaused = false;
        
        // Order questions by subject - sequential subjects
        orderQuestionsBySubject();
        
        // Initialize current subject index
        AppState.currentSubjectIndex = 0;
        updateCurrentSubject();
        
        // Start timer
        startTimer();
        
        // Show first question
        AppState.currentQuestionIndex = 0;
        displayQuestion();
        
        showScreen('quizScreen');
    } catch (error) {
        console.error('Error starting quiz:', error);
        alert('An error occurred while starting the quiz. Please try again.');
    }
}

function orderQuestionsBySubject() {
    // Sort questions by subject order in selectedSubjects
    const subjectOrder = {};
    AppState.selectedSubjects.forEach((subject, index) => {
        subjectOrder[subject] = index;
    });
    
    // Sort questions by subject order
    AppState.questions.sort((a, b) => {
        return subjectOrder[a.subject] - subjectOrder[b.subject];
    });
    
    // Re-map global indices after sorting
    AppState.questions.forEach((q, index) => {
        q.globalIndex = index;
        AppState.userAnswers[index].globalIndex = index;
    });
}

function updateCurrentSubject() {
    if (AppState.currentSubjectIndex < AppState.selectedSubjects.length) {
        AppState.currentSubject = AppState.selectedSubjects[AppState.currentSubjectIndex];
    }
}

function startTimer() {
    AppState.timer = setInterval(() => {
        if (AppState.timeRemaining > 0) {
            AppState.timeRemaining--;
            updateTimerDisplay();
            
            if (AppState.timeRemaining <= 0) {
                clearInterval(AppState.timer);
                submitQuiz();
            }
        }
    }, 1000);
}

function updateTimerDisplay() {
    const minutes = Math.floor(AppState.timeRemaining / 60);
    const seconds = AppState.timeRemaining % 60;
    const display = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    document.getElementById('timerDisplay').textContent = display;
    
    // Change color when low time
    if (AppState.timeRemaining < 300) { // Less than 5 minutes
        document.querySelector('.timer-container').style.background = 'var(--error-color)';
    } else if (AppState.timeRemaining < 600) { // Less than 10 minutes
        document.querySelector('.timer-container').style.background = 'var(--warning-color)';
    }
}

// ============================================
// QUESTION DISPLAY
// ============================================
function displayQuestion() {
    try {
        // Use subject-specific questions if set, otherwise use all questions
        const questions = AppState.subjectQuestions || AppState.questions;
        
        if (!questions || questions.length === 0) {
            alert('No questions available.');
            return;
        }
        
        const question = questions[AppState.currentQuestionIndex];
        
        if (!question) {
            alert('Question not found.');
            return;
        }
        
        // Update subject badge
        const subjectEl = document.getElementById('currentSubject');
        if (subjectEl) {
            subjectEl.textContent = question.subject || 'General';
        }
        
        // Update question text
        document.getElementById('questionText').textContent = question.question;
        
        // Update progress - use subject-specific progress
        document.getElementById('currentQuestionNum').textContent = AppState.currentQuestionIndex + 1;
        
        // Subject progress
        const subjectProgress = AppState.scores[question.subject];
        const answeredCount = subjectProgress.questions.filter(q => q.userAnswer !== null).length;
        document.getElementById('subjectProgress').textContent = 
            `${question.subject}: ${answeredCount}/${subjectProgress.total}`;
        
        // Update progress bar - for subject-specific view
        const progress = ((AppState.currentQuestionIndex + 1) / questions.length) * 100;
        document.getElementById('progressFill').style.width = `${progress}%`;
        
        // Update total questions display
        const totalQuestionsEl = document.getElementById('totalQuestions');
        if (totalQuestionsEl) {
            if (AppState.subjectQuestions) {
                totalQuestionsEl.textContent = questions.length;
            } else {
                totalQuestionsEl.textContent = AppState.questions.length;
            }
        }
        
        // Display options
        const optionsContainer = document.getElementById('optionsContainer');
        optionsContainer.innerHTML = '';
        
        const letters = ['A', 'B', 'C', 'D'];
        question.options.forEach((option, index) => {
            const optionEl = document.createElement('div');
            optionEl.className = 'option-item';
            optionEl.onclick = () => selectOption(index);
            
            // Check if this option was previously selected using global index
            const globalIndex = question.globalIndex;
            const userAnswer = AppState.userAnswers[globalIndex];
            if (userAnswer && userAnswer.selectedOption === index) {
                optionEl.classList.add('selected');
            }
            
            optionEl.innerHTML = `
                <span class="option-letter">${letters[index]}</span>
                <span class="option-text">${option}</span>
            `;
            
            optionsContainer.appendChild(optionEl);
        });
        
        // Update navigation buttons
        document.getElementById('prevBtn').disabled = AppState.currentQuestionIndex === 0;
        
        const nextBtn = document.getElementById('nextBtn');
        if (AppState.currentQuestionIndex === questions.length - 1) {
            nextBtn.textContent = 'Finish Subject';
        } else {
            nextBtn.textContent = 'Next';
        }
    } catch (error) {
        console.error('Error displaying question:', error);
        alert('An error occurred while displaying the question.');
    }
}

function selectOption(optionIndex) {
    // Use subject-specific questions if set
    const questions = AppState.subjectQuestions || AppState.questions;
    const question = questions[AppState.currentQuestionIndex];
    
    // Update user answer using global index
    const globalIndex = question.globalIndex;
    AppState.userAnswers[globalIndex].selectedOption = optionIndex;
    
    // Update score tracking for subject
    const subjectScore = AppState.scores[question.subject];
    const questionScore = subjectScore.questions.find(q => q.questionId === question.id);
    if (questionScore) {
        questionScore.userAnswer = optionIndex;
    }
    
    // Update UI
    const options = document.querySelectorAll('.option-item');
    options.forEach((opt, index) => {
        opt.classList.remove('selected');
        if (index === optionIndex) {
            opt.classList.add('selected');
        }
    });
}

function prevQuestion() {
    if (AppState.currentQuestionIndex > 0) {
        AppState.currentQuestionIndex--;
        displayQuestion();
    }
}

function nextQuestion() {
    const currentSubject = AppState.currentSubject;
    const questionsInCurrentSubject = AppState.questions.filter(q => q.subject === currentSubject);
    const lastQuestionInSubject = AppState.currentQuestionIndex >= questionsInCurrentSubject.length - 1;
    
    if (lastQuestionInSubject) {
        // Check if there's another subject
        if (AppState.currentSubjectIndex < AppState.selectedSubjects.length - 1) {
            // Move to next subject
            AppState.currentSubjectIndex++;
            updateCurrentSubject();
            
            // Find first question of next subject
            const nextSubject = AppState.currentSubject;
            const firstQuestionIndex = AppState.questions.findIndex(q => q.subject === nextSubject);
            AppState.currentQuestionIndex = firstQuestionIndex;
            displayQuestion();
        } else {
            // Last question of last subject - submit
            if (AppState.allowReview) {
                if (confirm('You have answered all questions. Would you like to review your answers before submitting?')) {
                    // Stay on current question
                    AppState.currentQuestionIndex = 0;
                    displayQuestion();
                } else {
                    submitQuiz();
                }
            } else {
                submitQuiz();
            }
        }
    } else {
        // Move to next question
        AppState.currentQuestionIndex++;
        displayQuestion();
    }
}

function skipQuestion() {
    const currentSubject = AppState.currentSubject;
    const questionsInCurrentSubject = AppState.questions.filter(q => q.subject === currentSubject);
    const lastQuestionInSubject = AppState.currentQuestionIndex >= questionsInCurrentSubject.length - 1;
    
    if (lastQuestionInSubject) {
        // Move to next subject
        if (AppState.currentSubjectIndex < AppState.selectedSubjects.length - 1) {
            AppState.currentSubjectIndex++;
            updateCurrentSubject();
            
            const nextSubject = AppState.currentSubject;
            const firstQuestionIndex = AppState.questions.findIndex(q => q.subject === nextSubject);
            AppState.currentQuestionIndex = firstQuestionIndex;
            displayQuestion();
        }
    } else {
        AppState.currentQuestionIndex++;
        displayQuestion();
    }
}

// ============================================
// QUIZ SUBMISSION & SCORING
// ============================================
function submitQuiz() {
    // Stop timer
    clearInterval(AppState.timer);
    
    // Mark code as used
    markCodeAsUsed(AppState.user.examCode);
    
    // Calculate scores
    let totalCorrect = 0;
    let totalQuestions = AppState.questions.length;
    
    AppState.questions.forEach((question) => {
        const globalIndex = question.globalIndex;
        const userAnswer = AppState.userAnswers[globalIndex];
        const isCorrect = userAnswer && userAnswer.selectedOption === question.correctAnswer;
        
        if (isCorrect) {
            totalCorrect++;
            AppState.scores[question.subject].correct++;
        }
        
        // Update question score
        const subjectScore = AppState.scores[question.subject];
        const questionScore = subjectScore.questions.find(q => q.questionId === question.id);
        if (questionScore) {
            questionScore.isCorrect = isCorrect;
            questionScore.userAnswer = userAnswer ? userAnswer.selectedOption : null;
            questionScore.correctAnswer = question.correctAnswer;
        }
    });
    
    // Display results
    const percentage = Math.round((totalCorrect / totalQuestions) * 100);
    document.getElementById('totalScore').textContent = totalCorrect;
    document.getElementById('maxScore').textContent = totalQuestions;
    document.getElementById('scorePercentage').textContent = percentage;
    
    // Display score breakdown
    displayScoreBreakdown();
    
    // Save results to localStorage
    saveResults(totalCorrect, totalQuestions, percentage);
    
    showScreen('quizCompleteScreen');
}

function displayScoreBreakdown() {
    const breakdownContainer = document.getElementById('scoreBreakdown');
    breakdownContainer.innerHTML = '';
    
    AppState.selectedSubjects.forEach(subject => {
        const score = AppState.scores[subject];
        const percentage = Math.round((score.correct / score.total) * 100);
        
        const item = document.createElement('div');
        item.className = 'breakdown-item';
        item.innerHTML = `
            <span class="breakdown-subject">${subject}</span>
            <div class="breakdown-score">
                <div class="breakdown-bar">
                    <div class="breakdown-fill" style="width: ${percentage}%"></div>
                </div>
                <span class="breakdown-text">${score.correct}/${score.total}</span>
            </div>
        `;
        
        breakdownContainer.appendChild(item);
    });
}

// ============================================
// REVIEW ANSWERS
// ============================================
function showReview() {
    displayReviewAnswers('all');
    showScreen('reviewScreen');
}

function displayReviewAnswers(filter) {
    const container = document.getElementById('reviewContainer');
    container.innerHTML = '';
    
    const letters = ['A', 'B', 'C', 'D'];
    
    AppState.questions.forEach((question, index) => {
        const userAnswer = AppState.userAnswers[index];
        const isCorrect = userAnswer.selectedOption === question.correctAnswer;
        
        // Apply filter
        if (filter === 'correct' && !isCorrect) return;
        if (filter === 'incorrect' && isCorrect) return;
        if (filter !== 'all' && filter !== 'correct' && filter !== 'incorrect' && question.subject !== filter) return;
        
        const item = document.createElement('div');
        item.className = `review-item ${isCorrect ? 'correct' : 'incorrect'}`;
        
        item.innerHTML = `
            <div class="review-question-header">
                <span class="review-subject">${question.subject}</span>
                <span class="review-status ${isCorrect ? 'correct' : 'incorrect'}">
                    ${isCorrect ? '✓ Correct' : '✗ Incorrect'}
                </span>
            </div>
            <p class="review-question">${index + 1}. ${question.question}</p>
            <div class="review-answer user-answer">
                <div class="review-answer-label">Your Answer:</div>
                ${userAnswer.selectedOption !== null 
                    ? `${letters[userAnswer.selectedOption]}. ${question.options[userAnswer.selectedOption]}` 
                    : '<em>Not answered</em>'}
            </div>
            ${!isCorrect ? `
                <div class="review-answer correct-answer">
                    <div class="review-answer-label">Correct Answer:</div>
                    ${letters[question.correctAnswer]}. ${question.options[question.correctAnswer]}
                </div>
            ` : ''}
        `;
        
        container.appendChild(item);
    });
}

function filterReview() {
    const filter = document.getElementById('reviewFilter').value;
    displayReviewAnswers(filter);
}

// ============================================
// LOCAL STORAGE
// ============================================
function loadCodes() {
    const storedCodes = localStorage.getItem('examCodes');
    if (storedCodes) {
        AppState.codes = JSON.parse(storedCodes);
    } else {
        // Initialize with default codes
        AppState.codes = [...DEFAULT_CODES];
        localStorage.setItem('examCodes', JSON.stringify(AppState.codes));
    }
}

function loadSubjects() {
    // Initialize default data if not exists
    initializeDefaultData();
    
    const storedSubjects = localStorage.getItem('quizSubjects');
    if (storedSubjects) {
        AppState.subjects = JSON.parse(storedSubjects);
    } else {
        AppState.subjects = [...DEFAULT_SUBJECTS];
    }
    
    // Build questions object
    AppState.allQuestions = {};
    AppState.subjects.forEach(sub => {
        AppState.allQuestions[sub.name] = sub.questions || [];
    });
}

function saveResults(totalCorrect, totalQuestions, percentage) {
    const result = {
        id: Date.now(),
        user: { ...AppState.user },
        subjects: [...AppState.selectedSubjects],
        scores: { ...AppState.scores },
        totalCorrect,
        totalQuestions,
        percentage,
        date: new Date().toISOString()
    };
    
    // Load existing results
    const storedResults = localStorage.getItem('quizResults');
    AppState.results = storedResults ? JSON.parse(storedResults) : [];
    
    // Add new result
    AppState.results.push(result);
    
    // Save
    localStorage.setItem('quizResults', JSON.stringify(AppState.results));
}

function loadResults() {
    const storedResults = localStorage.getItem('quizResults');
    AppState.results = storedResults ? JSON.parse(storedResults) : [];
}

// ============================================
// PDF EXPORT
// ============================================
function exportToPDF() {
    // Create PDF content
    const user = AppState.user;
    let totalCorrect = 0;
    let totalQuestions = 0;
    
    let content = `
        SMART QUIZ ENGINE - EXAMINATION RESULTS
        ========================================
        
        Student Name: ${user.fullName}
        Email: ${user.email}
        Phone: ${user.phone || 'N/A'}
        School: ${user.school || 'N/A'}
        Exam Code: ${user.examCode}
        Date: ${new Date().toLocaleDateString()}
        
        ========================================
        SUBJECT BREAKDOWN
        ========================================
    `;
    
    AppState.selectedSubjects.forEach(subject => {
        const score = AppState.scores[subject];
        totalCorrect += score.correct;
        totalQuestions += score.total;
        const percentage = Math.round((score.correct / score.total) * 100);
        
        content += `
    ${subject}: ${score.correct}/${score.total} (${percentage}%)
        `;
    });
    
    const overallPercentage = Math.round((totalCorrect / totalQuestions) * 100);
    
    content += `
        ========================================
        TOTAL SCORE: ${totalCorrect}/${totalQuestions} (${overallPercentage}%)
        ========================================
        
        Generated by Smart Quiz Engine
    `;
    
    // Create downloadable file
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Quiz_Results_${user.fullName.replace(/\s+/g, '_')}_${new Date().toISOString().split('T')[0]}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

// ============================================
// ADMIN PANEL
// ============================================

// Load admins from localStorage
function loadAdmins() {
    const storedAdmins = localStorage.getItem('quizAdmins');
    if (storedAdmins) {
        AppState.admins = JSON.parse(storedAdmins);
    } else {
        // Default admin
        AppState.admins = [{
            id: 'admin',
            username: 'admin',
            password: 'admin123',
            fullName: 'Super Admin',
            email: 'admin@quiz.com',
            phone: '',
            role: 'super_admin'
        }];
        localStorage.setItem('quizAdmins', JSON.stringify(AppState.admins));
    }
}

function handleAdminLogin(event) {
    event.preventDefault();
    
    loadAdmins();
    
    const username = document.getElementById('adminUsername').value;
    const password = document.getElementById('adminPassword').value;
    
    // Check against stored admins
    const admin = AppState.admins.find(a => a.username === username && a.password === password);
    
    if (admin) {
        AppState.adminLoggedIn = true;
        localStorage.setItem('adminSession', 'true');
        localStorage.setItem('currentAdmin', JSON.stringify(admin));
        AppState.user = {
            fullName: '',
            email: '',
            phone: '',
            school: '',
            examCode: ''
        };
        localStorage.removeItem('currentUser');
        localStorage.removeItem('examSession');
        document.getElementById('userInfo').style.display = 'none';
        document.getElementById('adminLink').style.display = 'block';
        
        loadCodes();
        loadResults();
        renderCodesTable();
        renderResultsList();
        renderAdminList();
        showScreen('adminDashboardScreen');
    } else {
        alert('Invalid admin credentials');
    }
}

// Admin Management Functions
function renderAdminList() {
    loadAdmins();
    const container = document.getElementById('adminList');
    if (!container) return;
    
    // Get current admin
    const currentAdminJson = localStorage.getItem('currentAdmin');
    if (!currentAdminJson) {
        container.innerHTML = '<p style="color: var(--text-light);">Please log in to view admins</p>';
        return;
    }
    
    const currentAdmin = JSON.parse(currentAdminJson);
    
    // Only super_admin can see and manage admins
    if (currentAdmin.role !== 'super_admin') {
        container.innerHTML = '<p style="color: var(--text-light);">You do not have permission to manage admins</p>';
        document.getElementById('addAdminBtn').style.display = 'none';
        return;
    }
    
    // Show Add Admin button for super_admin
    document.getElementById('addAdminBtn').style.display = 'inline-block';
    
    if (AppState.admins.length === 0) {
        container.innerHTML = '<p style="color: var(--text-light);">No admins found</p>';
        return;
    }
    
    container.innerHTML = AppState.admins.map((admin, index) => `
        <div style="display: flex; justify-content: space-between; align-items: center; padding: 10px; border-bottom: 1px solid var(--border-color);">
            <div>
                <strong>${admin.fullName}</strong>
                <div style="font-size: 0.85rem; color: var(--text-light);">${admin.username} | ${admin.email}</div>
            </div>
            <div>
                <button onclick="editAdmin(${index})" style="padding: 5px 10px; background: #3498db; color: white; border: none; border-radius: 4px; cursor: pointer; margin-right: 5px;">✏️</button>
                ${index > 0 ? `<button onclick="deleteAdmin(${index})" style="padding: 5px 10px; background: var(--error-color); color: white; border: none; border-radius: 4px; cursor: pointer;">🗑️</button>` : ''}
            </div>
        </div>
    `).join('');
}

function showAddAdminModal() {
    // Check if current admin is super_admin
    const currentAdminJson = localStorage.getItem('currentAdmin');
    if (!currentAdminJson) {
        alert('Please log in to manage admins');
        return;
    }
    
    const currentAdmin = JSON.parse(currentAdminJson);
    if (currentAdmin.role !== 'super_admin') {
        alert('You do not have permission to add admins');
        return;
    }
    
    const modalHtml = `
        <div style="position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.5); display: flex; align-items: center; justify-content: center; z-index: 1000;" onclick="closeAdminModal(event)">
            <div style="background: white; border-radius: 12px; padding: 30px; max-width: 450px; width: 90%;">
                <h2 style="margin-bottom: 20px; color: var(--primary-color);">Add New Admin</h2>
                
                <div style="margin-bottom: 15px;">
                    <label style="display: block; margin-bottom: 5px; font-weight: 600;">Full Name</label>
                    <input type="text" id="newAdminFullName" style="width: 100%; padding: 10px; border: 2px solid var(--border-color); border-radius: 6px;">
                </div>
                
                <div style="margin-bottom: 15px;">
                    <label style="display: block; margin-bottom: 5px; font-weight: 600;">Username</label>
                    <input type="text" id="newAdminUsername" style="width: 100%; padding: 10px; border: 2px solid var(--border-color); border-radius: 6px;">
                </div>
                
                <div style="margin-bottom: 15px;">
                    <label style="display: block; margin-bottom: 5px; font-weight: 600;">Password</label>
                    <input type="password" id="newAdminPassword" style="width: 100%; padding: 10px; border: 2px solid var(--border-color); border-radius: 6px;">
                </div>
                
                <div style="margin-bottom: 15px;">
                    <label style="display: block; margin-bottom: 5px; font-weight: 600;">Email</label>
                    <input type="email" id="newAdminEmail" style="width: 100%; padding: 10px; border: 2px solid var(--border-color); border-radius: 6px;">
                </div>
                
                <div style="margin-bottom: 20px;">
                    <label style="display: block; margin-bottom: 5px; font-weight: 600;">Phone Number</label>
                    <input type="text" id="newAdminPhone" style="width: 100%; padding: 10px; border: 2px solid var(--border-color); border-radius: 6px;">
                </div>
                
                <div style="display: flex; gap: 10px;">
                    <button onclick="closeAdminModal()" style="flex: 1; padding: 12px; background: var(--border-color); border: none; border-radius: 6px; cursor: pointer;">Cancel</button>
                    <button onclick="saveNewAdmin()" style="flex: 1; padding: 12px; background: var(--primary-color); color: white; border: none; border-radius: 6px; cursor: pointer;">Add Admin</button>
                </div>
            </div>
        </div>
    `;
    
    const existingModal = document.getElementById('adminModal');
    if (existingModal) existingModal.remove();
    
    const modalDiv = document.createElement('div');
    modalDiv.id = 'adminModal';
    modalDiv.innerHTML = modalHtml;
    document.body.appendChild(modalDiv);
}

function closeAdminModal(event) {
    if (!event || event.target === event.currentTarget) {
        const modal = document.getElementById('adminModal');
        if (modal) modal.remove();
    }
}

function saveNewAdmin() {
    loadAdmins();
    
    const fullName = document.getElementById('newAdminFullName').value.trim();
    const username = document.getElementById('newAdminUsername').value.trim();
    const password = document.getElementById('newAdminPassword').value.trim();
    const email = document.getElementById('newAdminEmail').value.trim();
    const phone = document.getElementById('newAdminPhone').value.trim();
    
    if (!fullName || !username || !password || !email) {
        alert('Please fill in all required fields');
        return;
    }
    
    // Check if username already exists
    if (AppState.admins.find(a => a.username === username)) {
        alert('Username already exists');
        return;
    }
    
    const newAdmin = {
        id: username,
        username: username,
        password: password,
        fullName: fullName,
        email: email,
        phone: phone,
        role: 'admin'
    };
    
    AppState.admins.push(newAdmin);
    localStorage.setItem('quizAdmins', JSON.stringify(AppState.admins));
    
    closeAdminModal();
    renderAdminList();
}

function editAdmin(index) {
    // Check if current admin is super_admin
    const currentAdminJson = localStorage.getItem('currentAdmin');
    if (!currentAdminJson) {
        alert('Please log in to manage admins');
        return;
    }
    
    const currentAdmin = JSON.parse(currentAdminJson);
    if (currentAdmin.role !== 'super_admin') {
        alert('You do not have permission to edit admins');
        return;
    }
    
    loadAdmins();
    const admin = AppState.admins[index];
    
    const modalHtml = `
        <div style="position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.5); display: flex; align-items: center; justify-content: center; z-index: 1000;" onclick="closeAdminModal(event)">
            <div style="background: white; border-radius: 12px; padding: 30px; max-width: 450px; width: 90%;">
                <h2 style="margin-bottom: 20px; color: var(--primary-color);">Edit Admin</h2>
                
                <div style="margin-bottom: 15px;">
                    <label style="display: block; margin-bottom: 5px; font-weight: 600;">Full Name</label>
                    <input type="text" id="editAdminFullName" value="${admin.fullName}" style="width: 100%; padding: 10px; border: 2px solid var(--border-color); border-radius: 6px;">
                </div>
                
                <div style="margin-bottom: 15px;">
                    <label style="display: block; margin-bottom: 5px; font-weight: 600;">Username</label>
                    <input type="text" id="editAdminUsername" value="${admin.username}" disabled style="width: 100%; padding: 10px; border: 2px solid var(--border-color); border-radius: 6px; background: #f0f0f0;">
                </div>
                
                <div style="margin-bottom: 15px;">
                    <label style="display: block; margin-bottom: 5px; font-weight: 600;">New Password (leave blank to keep current)</label>
                    <input type="password" id="editAdminPassword" style="width: 100%; padding: 10px; border: 2px solid var(--border-color); border-radius: 6px;">
                </div>
                
                <div style="margin-bottom: 15px;">
                    <label style="display: block; margin-bottom: 5px; font-weight: 600;">Email</label>
                    <input type="email" id="editAdminEmail" value="${admin.email}" style="width: 100%; padding: 10px; border: 2px solid var(--border-color); border-radius: 6px;">
                </div>
                
                <div style="margin-bottom: 20px;">
                    <label style="display: block; margin-bottom: 5px; font-weight: 600;">Phone Number</label>
                    <input type="text" id="editAdminPhone" value="${admin.phone || ''}" style="width: 100%; padding: 10px; border: 2px solid var(--border-color); border-radius: 6px;">
                </div>
                
                <div style="display: flex; gap: 10px;">
                    <button onclick="closeAdminModal()" style="flex: 1; padding: 12px; background: var(--border-color); border: none; border-radius: 6px; cursor: pointer;">Cancel</button>
                    <button onclick="saveAdminEdit(${index})" style="flex: 1; padding: 12px; background: var(--primary-color); color: white; border: none; border-radius: 6px; cursor: pointer;">Save Changes</button>
                </div>
            </div>
        </div>
    `;
    
    const existingModal = document.getElementById('adminModal');
    if (existingModal) existingModal.remove();
    
    const modalDiv = document.createElement('div');
    modalDiv.id = 'adminModal';
    modalDiv.innerHTML = modalHtml;
    document.body.appendChild(modalDiv);
}

function saveAdminEdit(index) {
    loadAdmins();
    
    const fullName = document.getElementById('editAdminFullName').value.trim();
    const password = document.getElementById('editAdminPassword').value.trim();
    const email = document.getElementById('editAdminEmail').value.trim();
    const phone = document.getElementById('editAdminPhone').value.trim();
    
    if (!fullName || !email) {
        alert('Please fill in all required fields');
        return;
    }
    
    AppState.admins[index].fullName = fullName;
    AppState.admins[index].email = email;
    AppState.admins[index].phone = phone;
    
    if (password) {
        AppState.admins[index].password = password;
    }
    
    localStorage.setItem('quizAdmins', JSON.stringify(AppState.admins));
    
    closeAdminModal();
    renderAdminList();
}

function deleteAdmin(index) {
    // Check if current admin is super_admin
    const currentAdminJson = localStorage.getItem('currentAdmin');
    if (!currentAdminJson) {
        alert('Please log in to manage admins');
        return;
    }
    
    const currentAdmin = JSON.parse(currentAdminJson);
    if (currentAdmin.role !== 'super_admin') {
        alert('You do not have permission to delete admins');
        return;
    }
    
    if (confirm('Are you sure you want to delete this admin?')) {
        loadAdmins();
        AppState.admins.splice(index, 1);
        localStorage.setItem('quizAdmins', JSON.stringify(AppState.admins));
        renderAdminList();
    }
}

function showAdminTab(tabName) {
    // Update tab buttons
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.classList.remove('active');
    });
    event.target.classList.add('active');
    
    // Show/hide content
    if (tabName === 'codes') {
        document.getElementById('adminCodesTab').style.display = 'block';
        document.getElementById('adminSubjectsTab').style.display = 'none';
        document.getElementById('adminSettingsTab').style.display = 'none';
        document.getElementById('adminResultsTab').style.display = 'none';
    } else if (tabName === 'subjects') {
        document.getElementById('adminCodesTab').style.display = 'none';
        document.getElementById('adminSubjectsTab').style.display = 'block';
        document.getElementById('adminSettingsTab').style.display = 'none';
        document.getElementById('adminResultsTab').style.display = 'none';
        renderSubjectsTab();
    } else if (tabName === 'settings') {
        document.getElementById('adminCodesTab').style.display = 'none';
        document.getElementById('adminSubjectsTab').style.display = 'none';
        document.getElementById('adminSettingsTab').style.display = 'block';
        document.getElementById('adminResultsTab').style.display = 'none';
        loadSettingsInfo();
        renderAdminList();
    } else {
        document.getElementById('adminCodesTab').style.display = 'none';
        document.getElementById('adminSubjectsTab').style.display = 'none';
        document.getElementById('adminSettingsTab').style.display = 'none';
        document.getElementById('adminResultsTab').style.display = 'block';
    }
}

function loadSettingsInfo() {
    loadSubjects();
    loadCodes();
    loadResults();
    
    // Count total questions
    let totalQuestions = 0;
    AppState.subjects.forEach(s => {
        totalQuestions += (s.questions ? s.questions.length : 0);
    });
    
    document.getElementById('settingsSubjectCount').textContent = AppState.subjects.length;
    document.getElementById('settingsQuestionCount').textContent = totalQuestions;
    document.getElementById('settingsCodeCount').textContent = AppState.codes.length;
    document.getElementById('settingsResultCount').textContent = AppState.results.length;
}

function exportAllData() {
    const data = {
        subjects: AppState.subjects,
        codes: AppState.codes,
        results: AppState.results,
        exportDate: new Date().toISOString()
    };
    
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'quiz-data-' + new Date().toISOString().split('T')[0] + '.json';
    a.click();
    URL.revokeObjectURL(url);
}

function importData() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = function(e) {
        const file = e.target.files[0];
        const reader = new FileReader();
        reader.onload = function(event) {
            try {
                const data = JSON.parse(event.target.result);
                if (data.subjects) localStorage.setItem('quizSubjects', JSON.stringify(data.subjects));
                if (data.codes) localStorage.setItem('examCodes', JSON.stringify(data.codes));
                if (data.results) localStorage.setItem('quizResults', JSON.stringify(data.results));
                alert('Data imported successfully!');
                loadSettingsInfo();
            } catch (err) {
                alert('Error importing data: ' + err.message);
            }
        };
        reader.readAsText(file);
    };
    input.click();
}

function resetAllData() {
    if (confirm('Are you sure you want to reset ALL data? This cannot be undone!')) {
        if (confirm('This will delete all subjects, questions, codes, and results. Continue?')) {
            localStorage.removeItem('quizSubjects');
            localStorage.removeItem('examCodes');
            localStorage.removeItem('quizResults');
            initializeDefaultData();
            loadSubjects();
            loadCodes();
            alert('All data has been reset.');
            loadSettingsInfo();
        }
    }
}

// CSV Question Upload Functions
function downloadQuestionTemplate() {
    loadSubjects();
    const subjects = AppState.subjects.map(s => s.name);
    
    // Create template CSV content
    const template = `Subject,Question,Option A,Option B,Option C,Option D,Correct Answer
English,What is the synonym of 'Happy'?,Joyful,Sad,Angry,Tired,A
Mathematics,What is 2 + 2?,3,4,5,6,B
${subjects.slice(0, 3).map(s => `${s},Sample question for ${s},Option A,Option B,Option C,Option D,A`).join('\n')}`;
    
    const blob = new Blob([template], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'question_template.csv';
    link.click();
}

function uploadQuestionsCSV() {
    const fileInput = document.getElementById('csvQuestionFile');
    const file = fileInput.files[0];
    
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            const csv = e.target.result;
            const lines = csv.split('\n').filter(line => line.trim());
            
            if (lines.length < 2) {
                alert('CSV file is empty or invalid');
                return;
            }
            
            // Parse CSV
            const questions = [];
            for (let i = 1; i < lines.length; i++) {
                const line = lines[i].trim();
                if (!line) continue;
                
                // Handle quoted values
                const values = [];
                let current = '';
                let inQuotes = false;
                for (let j = 0; j < line.length; j++) {
                    const char = line[j];
                    if (char === '"') {
                        inQuotes = !inQuotes;
                    } else if (char === ',' && !inQuotes) {
                        values.push(current.trim());
                        current = '';
                    } else {
                        current += char;
                    }
                }
                values.push(current.trim());
                
                if (values.length >= 7) {
                    const subject = values[0];
                    const question = values[1];
                    const options = [values[2], values[3], values[4], values[5]];
                    const correctAnswer = values[6].toUpperCase();
                    
                    // Convert letter to index (A=0, B=1, C=2, D=3)
                    const correctIndex = correctAnswer.charCodeAt(0) - 65;
                    
                    if (subject && question && options[0] && correctIndex >= 0 && correctIndex <= 3) {
                        questions.push({
                            subject: subject,
                            question: question,
                            options: options,
                            correctAnswer: correctIndex
                        });
                    }
                }
            };
            
            if (questions.length === 0) {
                alert('No valid questions found in CSV');
                return;
            }
            
            // Group questions by subject
            const questionsBySubject = {};
            questions.forEach(q => {
                if (!questionsBySubject[q.subject]) {
                    questionsBySubject[q.subject] = [];
                }
                questionsBySubject[q.subject].push(q);
            });
            
            // Save to subjects
            loadSubjects();
            
            let addedCount = 0;
            Object.keys(questionsBySubject).forEach(subjectName => {
                let subject = AppState.subjects.find(s => s.name === subjectName);
                
                if (!subject) {
                    // Create new subject
                    subject = {
                        name: subjectName,
                        questions: []
                    };
                    AppState.subjects.push(subject);
                }
                
                // Add questions to subject
                questionsBySubject[subjectName].forEach(q => {
                    const newQuestion = {
                        id: `${subjectName.toLowerCase()}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                        question: q.question,
                        options: q.options,
                        correctAnswer: q.correctAnswer
                    };
                    
                    if (!AppState.allQuestions[subjectName]) {
                        AppState.allQuestions[subjectName] = [];
                    }
                    AppState.allQuestions[subjectName].push(newQuestion);
                    addedCount++;
                });
            });
            
            // Save to localStorage
            localStorage.setItem('quizSubjects', JSON.stringify(AppState.subjects));
            localStorage.setItem('quizQuestions', JSON.stringify(AppState.allQuestions));
            
            // Show success message
            const statusEl = document.getElementById('csvUploadStatus');
            statusEl.textContent = `Successfully added ${addedCount} questions!`;
            statusEl.style.display = 'block';
            
            setTimeout(() => {
                statusEl.style.display = 'none';
            }, 5000);
            
            fileInput.value = ''; // Reset file input
            
        } catch (err) {
            alert('Error processing CSV: ' + err.message);
        }
    };
    reader.readAsText(file);
}

// Subject Management
function renderSubjectsTab() {
    loadSubjects();
    const container = document.getElementById('subjectsList');
    
    if (AppState.subjects.length === 0) {
        container.innerHTML = '<p style="text-align: center; color: var(--text-light);">No subjects yet. Click "Add Subject" to create one.</p>';
        return;
    }
    
    let html = '';
    AppState.subjects.forEach((subject, index) => {
        const questionCount = subject.questions ? subject.questions.length : 0;
        
        // Format date and time separately
        let dateDisplay = 'N/A';
        let timeDisplay = '';
        if (subject.createdAt) {
            const dateObj = new Date(subject.createdAt);
            dateDisplay = dateObj.toLocaleDateString('en-GB', { 
                day: '2-digit', 
                month: 'short', 
                year: 'numeric' 
            });
            timeDisplay = dateObj.toLocaleTimeString('en-GB', { 
                hour: '2-digit', 
                minute: '2-digit' 
            });
        }
        
        html += `
            <div class="subject-admin-card">
                <div class="subject-info">
                    <h3>${subject.name}</h3>
                    <p>📚 Questions: <strong>${questionCount}</strong></p>
                    <p>📅 Last Edited: ${dateDisplay}</p>
                    <p>🕐 Time: ${timeDisplay}</p>
                </div>
                <div class="subject-actions">
                    <button class="btn btn-sm" style="background: #3498db; color: white;" onclick="editSubject(${index})">✏️ Edit</button>
                    <button class="btn btn-sm btn-primary" onclick="manageQuestions(${index})">📝 Questions</button>
                    <button class="btn btn-sm btn-danger" onclick="deleteSubject(${index})">🗑️ Delete</button>
                </div>
            </div>
        `;
    });
    
    container.innerHTML = html;
}

// Add Questions Functions
function showAddQuestionChoice() {
    loadSubjects();
    
    const modalHtml = `
        <div style="position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.5); display: flex; align-items: center; justify-content: center; z-index: 1000;" onclick="closeAddQuestionChoiceModal(event)">
            <div style="background: white; border-radius: 12px; padding: 30px; max-width: 450px; width: 90%;">
                <h2 style="margin-bottom: 20px; color: var(--primary-color);">Add Questions</h2>
                
                <div style="margin-bottom: 20px;">
                    <label style="display: block; margin-bottom: 5px; font-weight: 600;">Select Subject</label>
                    <select id="questionSubjectSelect" style="width: 100%; padding: 10px; border: 2px solid var(--border-color); border-radius: 6px;">
                        <option value="">-- Select Subject --</option>
                        ${AppState.subjects.map(s => `<option value="${s.name}">${s.name}</option>`).join('')}
                    </select>
                </div>
                
                <p style="margin-bottom: 15px; font-weight: 600;">Choose how to add questions:</p>
                
                <div style="display: flex; flex-direction: column; gap: 10px;">
                    <button onclick="proceedToManualQuestion()" style="padding: 15px; background: var(--primary-color); color: white; border: none; border-radius: 6px; cursor: pointer; font-size: 1rem;">
                        ✏️ Add Questions Manually
                    </button>
                    <button onclick="proceedToCSVUpload()" style="padding: 15px; background: var(--success-color); color: white; border: none; border-radius: 6px; cursor: pointer; font-size: 1rem;">
                        📤 Upload via CSV
                    </button>
                </div>
                
                <button onclick="closeAddQuestionChoiceModal()" style="margin-top: 20px; width: 100%; padding: 12px; background: var(--border-color); border: none; border-radius: 6px; cursor: pointer;">Cancel</button>
            </div>
        </div>
    `;
    
    const existingModal = document.getElementById('addQuestionChoiceModal');
    if (existingModal) existingModal.remove();
    
    const modalDiv = document.createElement('div');
    modalDiv.id = 'addQuestionChoiceModal';
    modalDiv.innerHTML = modalHtml;
    document.body.appendChild(modalDiv);
}

function closeAddQuestionChoiceModal(event) {
    if (!event || event.target === event.currentTarget) {
        const modal = document.getElementById('addQuestionChoiceModal');
        if (modal) modal.remove();
    }
}

function proceedToManualQuestion() {
    const subject = document.getElementById('questionSubjectSelect').value;
    if (!subject) {
        alert('Please select a subject');
        return;
    }
    closeAddQuestionChoiceModal();
    showQuestionFormForSubject(subject);
}

function proceedToCSVUpload() {
    const subject = document.getElementById('questionSubjectSelect').value;
    if (!subject) {
        alert('Please select a subject');
        return;
    }
    closeAddQuestionChoiceModal();
    showCSVUploadForSubject(subject);
}

function showQuestionFormForSubject(subjectName) {
    const container = document.getElementById('questionManagerContainer');
    container.style.display = 'block';
    
    container.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px;">
            <h3 style="margin: 0;">Add Questions - ${subjectName}</h3>
            <button onclick="closeQuestionManagerContainer()" style="padding: 8px 15px; background: var(--border-color); border: none; border-radius: 4px; cursor: pointer;">✕ Close</button>
        </div>
        
        <div style="display: flex; gap: 10px; margin-bottom: 20px;">
            <button onclick="showAddQuestionChoice()" style="padding: 10px 15px; background: var(--primary-color); color: white; border: none; border-radius: 6px; cursor: pointer;">+ Add for Another Subject</button>
            <button onclick="addAnotherQuestion('${subjectName}')" style="padding: 10px 15px; background: var(--success-color); color: white; border: none; border-radius: 6px; cursor: pointer;">+ Add Another Question</button>
        </div>
        
        <div id="questionFormContainer">
            <!-- Question form will be here -->
        </div>
    `;
    
    // Show the first question form
    addAnotherQuestion(subjectName);
}

function addAnotherQuestion(subjectName) {
    const container = document.getElementById('questionFormContainer');
    const questionCount = container.children.length + 1;
    
    const formHtml = `
        <div style="background: white; padding: 20px; border-radius: 8px; margin-bottom: 15px; border: 1px solid var(--border-color);">
            <h4 style="margin-bottom: 15px;">Question ${questionCount}</h4>
            
            <div style="margin-bottom: 15px;">
                <label style="display: block; margin-bottom: 5px; font-weight: 600;">Question</label>
                <textarea id="q${questionCount}Text" rows="2" style="width: 100%; padding: 10px; border: 2px solid var(--border-color); border-radius: 6px;"></textarea>
            </div>
            
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 15px;">
                <div>
                    <label style="display: block; margin-bottom: 5px; font-weight: 600;">Option A</label>
                    <input type="text" id="q${questionCount}Opt0" style="width: 100%; padding: 8px; border: 2px solid var(--border-color); border-radius: 6px;">
                </div>
                <div>
                    <label style="display: block; margin-bottom: 5px; font-weight: 600;">Option B</label>
                    <input type="text" id="q${questionCount}Opt1" style="width: 100%; padding: 8px; border: 2px solid var(--border-color); border-radius: 6px;">
                </div>
                <div>
                    <label style="display: block; margin-bottom: 5px; font-weight: 600;">Option C</label>
                    <input type="text" id="q${questionCount}Opt2" style="width: 100%; padding: 8px; border: 2px solid var(--border-color); border-radius: 6px;">
                </div>
                <div>
                    <label style="display: block; margin-bottom: 5px; font-weight: 600;">Option D</label>
                    <input type="text" id="q${questionCount}Opt3" style="width: 100%; padding: 8px; border: 2px solid var(--border-color); border-radius: 6px;">
                </div>
            </div>
            
            <div style="margin-bottom: 15px;">
                <label style="display: block; margin-bottom: 5px; font-weight: 600;">Correct Answer</label>
                <select id="q${questionCount}Correct" style="width: 100%; padding: 8px; border: 2px solid var(--border-color); border-radius: 6px;">
                    <option value="0">Option A</option>
                    <option value="1">Option B</option>
                    <option value="2">Option C</option>
                    <option value="3">Option D</option>
                </select>
            </div>
            
            <button onclick="saveQuestionFromForm(${questionCount}, '${subjectName}')" style="padding: 10px 20px; background: var(--primary-color); color: white; border: none; border-radius: 6px; cursor: pointer;">Save Question</button>
        </div>
    `;
    
    container.insertAdjacentHTML('beforeend', formHtml);
}

function saveQuestionFromForm(questionNum, subjectName) {
    const question = document.getElementById(`q${questionNum}Text`).value.trim();
    const options = [
        document.getElementById(`q${questionNum}Opt0`).value.trim(),
        document.getElementById(`q${questionNum}Opt1`).value.trim(),
        document.getElementById(`q${questionNum}Opt2`).value.trim(),
        document.getElementById(`q${questionNum}Opt3`).value.trim()
    ];
    const correctAnswer = parseInt(document.getElementById(`q${questionNum}Correct`).value);
    
    if (!question || options.some(o => !o)) {
        alert('Please fill in all fields');
        return;
    }
    
    loadSubjects();
    
    const newQuestion = {
        id: `${subjectName.toLowerCase()}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        question: question,
        options: options,
        correctAnswer: correctAnswer
    };
    
    // Add to allQuestions
    if (!AppState.allQuestions[subjectName]) {
        AppState.allQuestions[subjectName] = [];
    }
    AppState.allQuestions[subjectName].push(newQuestion);
    localStorage.setItem('quizQuestions', JSON.stringify(AppState.allQuestions));
    
    alert('Question saved successfully!');
    
    // Clear form for next question
    document.getElementById(`q${questionNum}Text`).value = '';
    document.getElementById(`q${questionNum}Opt0`).value = '';
    document.getElementById(`q${questionNum}Opt1`).value = '';
    document.getElementById(`q${questionNum}Opt2`).value = '';
    document.getElementById(`q${questionNum}Opt3`).value = '';
}

function closeQuestionManagerContainer() {
    const container = document.getElementById('questionManagerContainer');
    container.style.display = 'none';
    container.innerHTML = '';
}

function showCSVUploadForSubject(subjectName) {
    const container = document.getElementById('questionManagerContainer');
    container.style.display = 'block';
    
    container.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px;">
            <h3 style="margin: 0;">Upload Questions - ${subjectName}</h3>
            <button onclick="closeQuestionManagerContainer()" style="padding: 8px 15px; background: var(--border-color); border: none; border-radius: 4px; cursor: pointer;">✕ Close</button>
        </div>
        
        <div style="background: white; padding: 20px; border-radius: 8px; border: 1px solid var(--border-color);">
            <p style="margin-bottom: 15px;">Download the format, fill in your questions, then upload.</p>
            
            <div style="display: flex; gap: 10px; margin-bottom: 15px;">
                <button onclick="downloadQuestionTemplateForSubject('${subjectName}')" class="btn btn-outline">📥 Download Format</button>
                <label class="btn btn-primary" style="cursor: pointer;">
                    📤 Upload CSV
                    <input type="file" id="csvQuestionFileSubject" accept=".csv" style="display: none;" onchange="uploadQuestionsCSVForSubject('${subjectName}')">
                </label>
            </div>
            
            <p id="csvUploadStatusSubject" style="margin-top: 10px; color: var(--success-color); display: none;"></p>
        </div>
    `;
}

function downloadQuestionTemplateForSubject(subjectName) {
    const template = `Question,Option A,Option B,Option C,Option D,Correct Answer
Sample question for ${subjectName},Option A,Option B,Option C,Option D,A`;
    
    const blob = new Blob([template], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `${subjectName}_questions_template.csv`;
    link.click();
}

function uploadQuestionsCSVForSubject(subjectName) {
    const fileInput = document.getElementById('csvQuestionFileSubject');
    const file = fileInput.files[0];
    
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            const csv = e.target.result;
            const lines = csv.split('\n').filter(line => line.trim());
            
            if (lines.length < 2) {
                alert('CSV file is empty or invalid');
                return;
            }
            
            const questions = [];
            for (let i = 1; i < lines.length; i++) {
                const line = lines[i].trim();
                if (!line) continue;
                
                const values = [];
                let current = '';
                let inQuotes = false;
                for (let j = 0; j < line.length; j++) {
                    const char = line[j];
                    if (char === '"') {
                        inQuotes = !inQuotes;
                    } else if (char === ',' && !inQuotes) {
                        values.push(current.trim());
                        current = '';
                    } else {
                        current += char;
                    }
                }
                values.push(current.trim());
                
                if (values.length >= 6) {
                    const question = values[0];
                    const options = [values[1], values[2], values[3], values[4]];
                    const correctAnswer = values[5].toUpperCase();
                    const correctIndex = correctAnswer.charCodeAt(0) - 65;
                    
                    if (question && options[0] && correctIndex >= 0 && correctIndex <= 3) {
                        questions.push({
                            question: question,
                            options: options,
                            correctAnswer: correctIndex
                        });
                    }
                }
            };
            
            if (questions.length === 0) {
                alert('No valid questions found in CSV');
                return;
            }
            
            loadSubjects();
            
            // Save questions to subject
            if (!AppState.allQuestions[subjectName]) {
                AppState.allQuestions[subjectName] = [];
            }
            
            let addedCount = 0;
            questions.forEach(q => {
                const newQuestion = {
                    id: `${subjectName.toLowerCase()}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                    question: q.question,
                    options: q.options,
                    correctAnswer: q.correctAnswer
                };
                AppState.allQuestions[subjectName].push(newQuestion);
                addedCount++;
            });
            
            localStorage.setItem('quizQuestions', JSON.stringify(AppState.allQuestions));
            
            const statusEl = document.getElementById('csvUploadStatusSubject');
            statusEl.textContent = `Successfully added ${addedCount} questions to ${subjectName}!`;
            statusEl.style.display = 'block';
            
            setTimeout(() => {
                statusEl.style.display = 'none';
            }, 5000);
            
            fileInput.value = '';
            
        } catch (err) {
            alert('Error processing CSV: ' + err.message);
        }
    };
    reader.readAsText(file);
}

function showAddSubjectModal() {
    let modalHtml = `
        <div style="position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.5); display: flex; align-items: center; justify-content: center; z-index: 1000;" onclick="closeSubjectModal(event)">
            <div style="background: white; border-radius: 12px; padding: 30px; max-width: 400px; width: 90%;">
                <h2 style="margin-bottom: 15px; color: var(--primary-color);">Add New Subject</h2>
                <div style="margin-bottom: 20px;">
                    <label style="display: block; margin-bottom: 5px; font-weight: 600;">Subject Name</label>
                    <input type="text" id="newSubjectName" placeholder="Enter subject name" style="width: 100%; padding: 10px; border: 2px solid var(--border-color); border-radius: 6px;">
                </div>
                <div style="display: flex; gap: 10px;">
                    <button onclick="closeSubjectModal()" style="flex: 1; padding: 12px; background: var(--border-color); border: none; border-radius: 6px; cursor: pointer;">Cancel</button>
                    <button onclick="addSubject()" style="flex: 1; padding: 12px; background: var(--primary-color); color: white; border: none; border-radius: 6px; cursor: pointer;">Add Subject</button>
                </div>
            </div>
        </div>
    `;
    
    const existingModal = document.getElementById('subjectModal');
    if (existingModal) existingModal.remove();
    
    const modalDiv = document.createElement('div');
    modalDiv.id = 'subjectModal';
    modalDiv.innerHTML = modalHtml;
    document.body.appendChild(modalDiv);
}

function closeSubjectModal(event) {
    if (!event || event.target === event.currentTarget) {
        const modal = document.getElementById('subjectModal');
        if (modal) modal.remove();
    }
}

function addSubject() {
    const name = document.getElementById('newSubjectName').value.trim();
    if (!name) {
        alert('Please enter a subject name');
        return;
    }
    
    // Check if subject already exists
    if (AppState.subjects.some(s => s.name.toLowerCase() === name.toLowerCase())) {
        alert('A subject with this name already exists');
        return;
    }
    
    AppState.subjects.push({
        name: name,
        questions: [],
        createdAt: new Date().toISOString()
    });
    
    localStorage.setItem('quizSubjects', JSON.stringify(AppState.subjects));
    
    // Update allQuestions
    AppState.allQuestions[name] = [];
    
    closeSubjectModal();
    renderSubjectsTab();
}

function editSubject(index) {
    const subject = AppState.subjects[index];
    let modalHtml = `
        <div style="position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.5); display: flex; align-items: center; justify-content: center; z-index: 1000;" onclick="closeSubjectModal(event)">
            <div style="background: white; border-radius: 12px; padding: 30px; max-width: 400px; width: 90%;">
                <h2 style="margin-bottom: 15px; color: var(--primary-color);">Edit Subject</h2>
                <div style="margin-bottom: 20px;">
                    <label style="display: block; margin-bottom: 5px; font-weight: 600;">Subject Name</label>
                    <input type="text" id="editSubjectName" value="${subject.name}" style="width: 100%; padding: 10px; border: 2px solid var(--border-color); border-radius: 6px;">
                </div>
                <div style="display: flex; gap: 10px;">
                    <button onclick="closeSubjectModal()" style="flex: 1; padding: 12px; background: var(--border-color); border: none; border-radius: 6px; cursor: pointer;">Cancel</button>
                    <button onclick="saveSubjectEdit(${index})" style="flex: 1; padding: 12px; background: var(--primary-color); color: white; border: none; border-radius: 6px; cursor: pointer;">Save Changes</button>
                </div>
            </div>
        </div>
    `;
    
    const existingModal = document.getElementById('subjectModal');
    if (existingModal) existingModal.remove();
    
    const modalDiv = document.createElement('div');
    modalDiv.id = 'subjectModal';
    modalDiv.innerHTML = modalHtml;
    document.body.appendChild(modalDiv);
}

function saveSubjectEdit(index) {
    const newName = document.getElementById('editSubjectName').value.trim();
    if (!newName) {
        alert('Please enter a subject name');
        return;
    }
    
    const oldSubject = AppState.subjects[index];
    
    // Check if name already exists (excluding current)
    if (AppState.subjects.some((s, i) => i !== index && s.name.toLowerCase() === newName.toLowerCase())) {
        alert('A subject with this name already exists');
        return;
    }
    
    // Update subject name
    AppState.subjects[index].name = newName;
    
    // Update timestamp to reflect last edited time
    AppState.subjects[index].createdAt = new Date().toISOString();
    
    // Update allQuestions with new key
    if (oldSubject.name !== newName) {
        AppState.allQuestions[newName] = AppState.allQuestions[oldSubject.name] || [];
        delete AppState.allQuestions[oldSubject.name];
    }
    
    localStorage.setItem('quizSubjects', JSON.stringify(AppState.subjects));
    
    closeSubjectModal();
    renderSubjectsTab();
}

function deleteSubject(index) {
    const subject = AppState.subjects[index];
    if (confirm(`Are you sure you want to delete "${subject.name}"? This will also remove all questions in this subject.`)) {
        AppState.subjects.splice(index, 1);
        localStorage.setItem('quizSubjects', JSON.stringify(AppState.subjects));
        
        // Update allQuestions
        delete AppState.allQuestions[subject.name];
        
        renderSubjectsTab();
    }
}

function manageQuestions(subjectIndex) {
    const subject = AppState.subjects[subjectIndex];
    showQuestionManager(subjectIndex, subject.name);
}

function showQuestionManager(subjectIndex, subjectName) {
    loadSubjects();
    const subject = AppState.subjects[subjectIndex];
    const questions = subject.questions || [];
    
    let modalHtml = `
        <div style="position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.5); display: flex; align-items: center; justify-content: center; z-index: 1000;" onclick="closeQuestionManager(event)">
            <div style="background: white; border-radius: 12px; padding: 30px; max-width: 800px; width: 95%; max-height: 90vh; overflow-y: auto;">
                <h2 style="margin-bottom: 15px; color: var(--primary-color);">Manage Questions: ${subjectName}</h2>
                <p style="margin-bottom: 15px; color: var(--text-light);">Total Questions: <strong>${questions.length}</strong></p>
                
                <div style="margin-bottom: 20px;">
                    <button onclick="showAddQuestionForm(${subjectIndex})" style="padding: 10px 20px; background: var(--primary-color); color: white; border: none; border-radius: 6px; cursor: pointer;">+ Add Question</button>
                </div>
                
                <div id="questionList" style="max-height: 400px; overflow-y: auto;">
    `;
    
    if (questions.length === 0) {
        modalHtml += '<p style="text-align: center; color: var(--text-light);">No questions yet. Click "Add Question" to create one.</p>';
    } else {
        questions.forEach((q, qIndex) => {
            const questionText = q.question.length > 80 ? q.question.substring(0, 80) + '...' : q.question;
            modalHtml += `
                <div style="padding: 15px; border: 1px solid var(--border-color); border-radius: 8px; margin-bottom: 10px;">
                    <div style="display: flex; justify-content: space-between; align-items: start;">
                        <div style="flex: 1;">
                            <strong>Q${qIndex + 1}:</strong> ${questionText}
                            <div style="font-size: 0.85rem; color: var(--text-light); margin-top: 5px;">
                                🔹 Correct: ${q.options[q.correctAnswer]}
                            </div>
                        </div>
                        <div style="display: flex; gap: 5px;">
                            <button onclick="editQuestion(${subjectIndex}, ${qIndex})" style="padding: 5px 10px; background: #3498db; color: white; border: none; border-radius: 4px; cursor: pointer;">✏️ Edit</button>
                            <button onclick="deleteQuestion(${subjectIndex}, ${qIndex})" style="padding: 5px 10px; background: var(--error-color); color: white; border: none; border-radius: 4px; cursor: pointer;">🗑️ Delete</button>
                        </div>
                    </div>
                </div>
            `;
        });
    }
    
    modalHtml += `
                </div>
                
                <button onclick="closeQuestionManager()" style="margin-top: 20px; width: 100%; padding: 12px; background: var(--border-color); border: none; border-radius: 6px; cursor: pointer;">Close</button>
            </div>
        </div>
    `;
    
    const existingModal = document.getElementById('questionManagerModal');
    if (existingModal) existingModal.remove();
    
    const modalDiv = document.createElement('div');
    modalDiv.id = 'questionManagerModal';
    modalDiv.innerHTML = modalHtml;
    document.body.appendChild(modalDiv);
}

function closeQuestionManager(event) {
    if (!event || event.target === event.currentTarget) {
        const modal = document.getElementById('questionManagerModal');
        if (modal) modal.remove();
    }
}

function showAddQuestionForm(subjectIndex) {
    const formHtml = `
        <div style="padding: 20px; background: #f8fafc; border-radius: 8px; margin-bottom: 15px;">
            <h3 style="margin-bottom: 15px;">Add New Question</h3>
            
            <div style="margin-bottom: 15px;">
                <label style="display: block; margin-bottom: 5px; font-weight: 600;">Question</label>
                <textarea id="newQuestionText" rows="2" style="width: 100%; padding: 10px; border: 2px solid var(--border-color); border-radius: 6px;"></textarea>
            </div>
            
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 15px;">
                <div>
                    <label style="display: block; margin-bottom: 5px; font-weight: 600;">Option A</label>
                    <input type="text" id="newOption0" style="width: 100%; padding: 8px; border: 2px solid var(--border-color); border-radius: 6px;">
                </div>
                <div>
                    <label style="display: block; margin-bottom: 5px; font-weight: 600;">Option B</label>
                    <input type="text" id="newOption1" style="width: 100%; padding: 8px; border: 2px solid var(--border-color); border-radius: 6px;">
                </div>
                <div>
                    <label style="display: block; margin-bottom: 5px; font-weight: 600;">Option C</label>
                    <input type="text" id="newOption2" style="width: 100%; padding: 8px; border: 2px solid var(--border-color); border-radius: 6px;">
                </div>
                <div>
                    <label style="display: block; margin-bottom: 5px; font-weight: 600;">Option D</label>
                    <input type="text" id="newOption3" style="width: 100%; padding: 8px; border: 2px solid var(--border-color); border-radius: 6px;">
                </div>
            </div>
            
            <div style="margin-bottom: 15px;">
                <label style="display: block; margin-bottom: 5px; font-weight: 600;">Correct Answer</label>
                <select id="newCorrectAnswer" style="width: 100%; padding: 8px; border: 2px solid var(--border-color); border-radius: 6px;">
                    <option value="0">Option A</option>
                    <option value="1">Option B</option>
                    <option value="2">Option C</option>
                    <option value="3">Option D</option>
                </select>
            </div>
            
            <button onclick="saveQuestion(${subjectIndex})" style="padding: 10px 20px; background: var(--success-color); color: white; border: none; border-radius: 6px; cursor: pointer;">Save Question</button>
        </div>
    `;
    
    document.getElementById('questionList').innerHTML = formHtml;
}

function saveQuestion(subjectIndex) {
    const question = document.getElementById('newQuestionText').value.trim();
    const options = [
        document.getElementById('newOption0').value.trim(),
        document.getElementById('newOption1').value.trim(),
        document.getElementById('newOption2').value.trim(),
        document.getElementById('newOption3').value.trim()
    ];
    const correctAnswer = parseInt(document.getElementById('newCorrectAnswer').value);
    
    if (!question || options.some(o => !o)) {
        alert('Please fill in all fields');
        return;
    }
    
    loadSubjects();
    
    const newQuestion = {
        id: `${AppState.subjects[subjectIndex].name.toLowerCase()}-${Date.now()}`,
        question: question,
        options: options,
        correctAnswer: correctAnswer
    };
    
    AppState.subjects[subjectIndex].questions.push(newQuestion);
    
    // Update subject's last edited timestamp
    AppState.subjects[subjectIndex].createdAt = new Date().toISOString();
    
    localStorage.setItem('quizSubjects', JSON.stringify(AppState.subjects));
    
    // Update allQuestions
    AppState.allQuestions[AppState.subjects[subjectIndex].name] = AppState.subjects[subjectIndex].questions;
    
    showQuestionManager(subjectIndex, AppState.subjects[subjectIndex].name);
}

function editQuestion(subjectIndex, questionIndex) {
    loadSubjects();
    const subject = AppState.subjects[subjectIndex];
    const question = subject.questions[questionIndex];
    
    const optionsHtml = question.options.map((opt, i) => 
        `<div style="margin-bottom: 10px;">
            <label style="display: flex; align-items: center; gap: 10px;">
                <input type="radio" name="editCorrectAnswer" value="${i}" ${i === question.correctAnswer ? 'checked' : ''}>
                <input type="text" class="edit-option-input" value="${opt}" style="flex: 1; padding: 8px; border: 1px solid var(--border-color); border-radius: 4px;">
            </label>
        </div>`
    ).join('');
    
    const formHtml = `
        <div style="position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.5); display: flex; align-items: center; justify-content: center; z-index: 1100;" onclick="closeEditQuestionModal(event)">
            <div style="background: white; border-radius: 12px; padding: 30px; max-width: 600px; width: 95%; max-height: 90vh; overflow-y: auto;">
                <h2 style="margin-bottom: 15px; color: var(--primary-color);">Edit Question</h2>
                
                <div style="margin-bottom: 15px;">
                    <label style="display: block; margin-bottom: 5px; font-weight: 600;">Question</label>
                    <textarea id="editQuestionText" rows="3" style="width: 100%; padding: 10px; border: 2px solid var(--border-color); border-radius: 6px;">${question.question}</textarea>
                </div>
                
                <div style="margin-bottom: 15px;">
                    <label style="display: block; margin-bottom: 5px; font-weight: 600;">Options (select correct answer)</label>
                    <div id="editOptionsContainer">
                        ${optionsHtml}
                    </div>
                </div>
                
                <div style="display: flex; gap: 10px;">
                    <button onclick="closeEditQuestionModal()" style="flex: 1; padding: 12px; background: var(--border-color); border: none; border-radius: 6px; cursor: pointer;">Cancel</button>
                    <button onclick="saveQuestionEdit(${subjectIndex}, ${questionIndex})" style="flex: 1; padding: 12px; background: var(--primary-color); color: white; border: none; border-radius: 6px; cursor: pointer;">Save Changes</button>
                </div>
            </div>
        </div>
    `;
    
    const modalDiv = document.createElement('div');
    modalDiv.id = 'editQuestionModal';
    modalDiv.innerHTML = formHtml;
    document.body.appendChild(modalDiv);
}

function saveQuestionEdit(subjectIndex, questionIndex) {
    const questionText = document.getElementById('editQuestionText').value.trim();
    const optionInputs = document.querySelectorAll('.edit-option-input');
    const correctAnswerInputs = document.querySelectorAll('input[name="editCorrectAnswer"]');
    
    if (!questionText) {
        alert('Please enter a question');
        return;
    }
    
    const options = Array.from(optionInputs).map(input => input.value.trim());
    if (options.some(opt => !opt)) {
        alert('Please fill in all options');
        return;
    }
    
    let correctAnswer = 0;
    correctAnswerInputs.forEach((input, index) => {
        if (input.checked) correctAnswer = index;
    });
    
    // Update question
    AppState.subjects[subjectIndex].questions[questionIndex] = {
        ...AppState.subjects[subjectIndex].questions[questionIndex],
        question: questionText,
        options: options,
        correctAnswer: correctAnswer
    };
    
    // Update subject's last edited timestamp
    AppState.subjects[subjectIndex].createdAt = new Date().toISOString();
    
    localStorage.setItem('quizSubjects', JSON.stringify(AppState.subjects));
    
    // Update allQuestions
    AppState.allQuestions[AppState.subjects[subjectIndex].name] = AppState.subjects[subjectIndex].questions;
    
    closeEditQuestionModal();
    showQuestionManager(subjectIndex, AppState.subjects[subjectIndex].name);
}

function closeEditQuestionModal() {
    const modal = document.getElementById('editQuestionModal');
    if (modal) modal.remove();
}

function deleteQuestion(subjectIndex, questionIndex) {
    if (confirm('Are you sure you want to delete this question?')) {
        loadSubjects();
        
        AppState.subjects[subjectIndex].questions.splice(questionIndex, 1);
        localStorage.setItem('quizSubjects', JSON.stringify(AppState.subjects));
        
        // Update allQuestions
        AppState.allQuestions[AppState.subjects[subjectIndex].name] = AppState.subjects[subjectIndex].questions;
        
        showQuestionManager(subjectIndex, AppState.subjects[subjectIndex].name);
    }
}

// Question Papers Management
let questionPapers = {
    English: null,
    Mathematics: null,
    Physics: null,
    Chemistry: null
};

function loadQuestionPapers() {
    const stored = localStorage.getItem('questionPapers');
    if (stored) {
        questionPapers = JSON.parse(stored);
    }
}

function saveQuestionPapers() {
    localStorage.setItem('questionPapers', JSON.stringify(questionPapers));
}

function renderQuestionPapersTab() {
    loadQuestionPapers();
    loadSubjects();
    
    // Make sure tab exists
    let questionsTab = document.getElementById('adminQuestionsTab');
    if (!questionsTab) {
        questionsTab = document.createElement('div');
        questionsTab.id = 'adminQuestionsTab';
        questionsTab.className = 'admin-tab-content';
        questionsTab.style.display = 'none';
        
        const codesTab = document.getElementById('adminCodesTab');
        if (codesTab && codesTab.parentNode) {
            codesTab.parentNode.insertBefore(questionsTab, codesTab.nextSibling);
        }
    }
    
    const subjects = AppState.subjects.map(s => s.name);
    
    if (subjects.length === 0) {
        questionsTab.innerHTML = '<p style="text-align: center; color: var(--text-light);">No subjects available. Please create subjects first.</p>';
        return;
    }
    
    let html = `
        <h2 style="margin-bottom: 20px;">Upload Question Papers</h2>
        <p style="margin-bottom: 20px; color: var(--text-light);">Upload PDF or Word documents for each subject's exam questions.</p>
        
        <div class="question-papers-grid">
    `;
    
    subjects.forEach(subject => {
        const paper = questionPapers[subject];
        const hasPaper = paper !== null && paper !== undefined;
        
        html += `
            <div class="question-paper-card">
                <h3>${subject}</h3>
                ${hasPaper ? `
                    <div class="paper-info">
                        <p><strong>File:</strong> ${paper.fileName}</p>
                        <p><strong>Uploaded:</strong> ${new Date(paper.uploadedAt).toLocaleDateString()}</p>
                        <div class="paper-actions">
                            <button class="btn btn-sm btn-primary" onclick="viewQuestionPaper('${subject}')">View</button>
                            <button class="btn btn-sm btn-outline" onclick="downloadQuestionPaper('${subject}')">Download</button>
                            <button class="btn btn-sm btn-danger" onclick="deleteQuestionPaper('${subject}')">Delete</button>
                        </div>
                    </div>
                ` : `
                    <p class="no-paper">No question paper uploaded</p>
                `}
                
                <div class="upload-section">
                    <label for="upload-${subject}" class="upload-btn">
                        📎 Upload ${hasPaper ? 'New' : ''} File
                    </label>
                    <input type="file" id="upload-${subject}" accept=".pdf,.doc,.docx" onchange="handleQuestionUpload(event, '${subject}')" style="display: none;">
                    <p class="upload-hint">PDF, DOC, DOCX (Max 10MB)</p>
                </div>
            </div>
        `;
    });
    
    html += '</div>';
    
    questionsTab.innerHTML = html;
}

function handleQuestionUpload(event, subject) {
    const file = event.target.files[0];
    if (!file) return;
    
    // Check file size (10MB max)
    if (file.size > 10 * 1024 * 1024) {
        alert('File size must be less than 10MB');
        return;
    }
    
    // Check file type
    const allowedTypes = ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'];
    if (!allowedTypes.includes(file.type)) {
        alert('Only PDF and Word files are allowed');
        return;
    }
    
    const reader = new FileReader();
    reader.onload = function(e) {
        questionPapers[subject] = {
            fileName: file.name,
            fileType: file.type,
            data: e.target.result,
            uploadedAt: new Date().toISOString()
        };
        saveQuestionPapers();
        renderQuestionPapersTab();
        alert(`${subject} question paper uploaded successfully!`);
    };
    reader.readAsDataURL(file);
}

function viewQuestionPaper(subject) {
    const paper = questionPapers[subject];
    if (!paper) return;
    
    // Open in new window
    const blob = dataURLtoBlob(paper.data);
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank');
}

function downloadQuestionPaper(subject) {
    const paper = questionPapers[subject];
    if (!paper) return;
    
    const link = document.createElement('a');
    link.href = paper.data;
    link.download = paper.fileName;
    link.click();
}

function deleteQuestionPaper(subject) {
    if (confirm(`Are you sure you want to delete the ${subject} question paper?`)) {
        questionPapers[subject] = null;
        saveQuestionPapers();
        renderQuestionPapersTab();
    }
}

function dataURLtoBlob(dataurl) {
    var arr = dataurl.split(','), mime = arr[0].match(/:(.*?);/)[1],
        bstr = atob(arr[1]), n = bstr.length, u8arr = new Uint8Array(n);
    while(n--){
        u8arr[n] = bstr.charCodeAt(n);
    }
    return new Blob([u8arr], {type:mime});
}

function viewCurrentQuestionPaper() {
    const question = AppState.questions[AppState.currentQuestionIndex];
    const subject = question.subject;
    
    loadQuestionPapers();
    const paper = questionPapers[subject];
    
    if (!paper) {
        alert(`No question paper uploaded for ${subject}. Please use the built-in questions.`);
        return;
    }
    
    viewQuestionPaper(subject);
}

function generateNewCode() {
    // Load subjects first
    loadSubjects();
    
    // Show subject selection modal
    showCodeSubjectModal();
}

function showCodeSubjectModal() {
    loadSubjects();
    const subjects = AppState.subjects.map(s => s.name);
    
    let modalHtml = `
        <div style="position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.5); display: flex; align-items: center; justify-content: center; z-index: 1000; padding: 15px;" onclick="closeCodeModal(event)">
            <div style="background: white; border-radius: 12px; padding: 25px 20px; max-width: 500px; width: 100%; max-height: 90vh; overflow-y: auto;">
                <h2 style="margin-bottom: 20px; color: var(--primary-color); font-size: 1.3rem;">Generate New Code</h2>
                
                <div class="code-form-grid">
                    <div class="form-group">
                        <label style="display: block; margin-bottom: 5px; font-weight: 600;">Duration (min)</label>
                        <input type="number" id="newCodeDuration" value="30" min="5" max="180" style="width: 100%; padding: 12px; border: 2px solid var(--border-color); border-radius: 6px;">
                    </div>
                    <div class="form-group">
                        <label style="display: block; margin-bottom: 5px; font-weight: 600;">Questions/Subject</label>
                        <input type="number" id="newCodeQuestions" value="5" min="1" max="20" style="width: 100%; padding: 12px; border: 2px solid var(--border-color); border-radius: 6px;">
                    </div>
                    <div class="form-group">
                        <label style="display: block; margin-bottom: 5px; font-weight: 600;">Valid (hours)</label>
                        <input type="number" id="newCodeValidity" value="24" min="1" max="720" style="width: 100%; padding: 12px; border: 2px solid var(--border-color); border-radius: 6px;" title="How many hours the code remains valid">
                    </div>
                </div>
                
                <div style="margin-bottom: 15px;">
                    <label style="display: flex; align-items: flex-start; gap: 10px; padding: 12px; border: 1px solid var(--border-color); border-radius: 6px; cursor: pointer;">
                        <input type="checkbox" id="newCodeReview" checked style="margin-top: 3px;">
                        <span style="font-size: 0.9rem;">Allow students to review answers before submitting</span>
                    </label>
                </div>
                
                <p style="margin-bottom: 10px; color: var(--text-light); font-size: 0.95rem;">Select subjects for this exam code:</p>
                
                <div id="codeSubjectList" style="max-height: 200px; overflow-y: auto; margin-bottom: 20px;">
    `;
    
    subjects.forEach(subject => {
        modalHtml += `
            <label style="display: flex; align-items: center; gap: 10px; padding: 12px; border: 1px solid var(--border-color); border-radius: 6px; margin-bottom: 8px; cursor: pointer;">
                <input type="checkbox" value="${subject}" checked>
                <span>${subject}</span>
            </label>
        `;
    });
    
    modalHtml += `
                </div>
                
                <div style="display: flex; gap: 10px; flex-direction: column;">
                    <button onclick="confirmGenerateCode()" style="padding: 14px; background: var(--primary-color); color: white; border: none; border-radius: 6px; cursor: pointer; font-size: 1rem; font-weight: 600;">Generate Code</button>
                    <button onclick="closeCodeModal()" style="padding: 12px; background: var(--border-color); border: none; border-radius: 6px; cursor: pointer; font-size: 0.95rem;">Cancel</button>
                </div>
            </div>
        </div>
    `;
    
    // Remove existing modal
    const existingModal = document.getElementById('codeModal');
    if (existingModal) existingModal.remove();
    
    const modalDiv = document.createElement('div');
    modalDiv.id = 'codeModal';
    modalDiv.innerHTML = modalHtml;
    document.body.appendChild(modalDiv);
}

function closeCodeModal(event) {
    if (!event || event.target === event.currentTarget) {
        const modal = document.getElementById('codeModal');
        if (modal) modal.remove();
    }
}

function confirmGenerateCode() {
    const duration = parseInt(document.getElementById('newCodeDuration').value) || 30;
    const questionsPerSubject = parseInt(document.getElementById('newCodeQuestions').value) || 5;
    const validityHours = parseInt(document.getElementById('newCodeValidity').value) || 24;
    const allowReview = document.getElementById('newCodeReview').checked;
    const checkboxes = document.querySelectorAll('#codeSubjectList input:checked');
    const selectedSubjects = Array.from(checkboxes).map(cb => cb.value);
    
    if (selectedSubjects.length === 0) {
        alert('Please select at least one subject');
        return;
    }
    
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let code = '';
    for (let i = 0; i < 8; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    
    const newCode = {
        code: code,
        active: true,
        createdAt: new Date().toISOString(),
        validityHours: validityHours,
        subjects: selectedSubjects,
        duration: duration,
        questionsPerSubject: questionsPerSubject,
        allowReview: allowReview
    };
    
    AppState.codes.push(newCode);
    localStorage.setItem('examCodes', JSON.stringify(AppState.codes));
    
    closeCodeModal();
    renderCodesTable();
}

function renderCodesTable() {
    const tbody = document.getElementById('codesTableBody');
    tbody.innerHTML = '';
    
    AppState.codes.forEach((code, index) => {
        // Check if code is still valid
        const validityHours = code.validityHours || 24;
        const createdAt = new Date(code.createdAt);
        const now = new Date();
        const hoursPassed = (now - createdAt) / (1000 * 60 * 60);
        const isExpired = hoursPassed > validityHours;
        
        const status = isExpired ? 'Expired' : (code.active ? 'Active' : 'Inactive');
        const statusClass = isExpired ? 'expired' : (code.active ? 'active' : 'inactive');
        
        // Format subjects with badges for mobile, comma-separated for desktop
        let subjectsDisplay = '';
        if (code.subjects && code.subjects.length > 0) {
            subjectsDisplay = code.subjects.map(s => `<span class="subject-badge">${s}</span>`).join('');
        } else {
            subjectsDisplay = '<span class="no-subjects">None</span>';
        }
        
        const duration = code.duration ? code.duration + ' min' : '30 min';
        const questionsPerSubject = code.questionsPerSubject || 5;
        const validityDisplay = code.validityHours ? code.validityHours + ' hours' : '24 hours';
        
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td data-label="Code"><strong>${code.code}</strong></td>
            <td data-label="Status"><span class="status-badge ${statusClass}">${status}</span></td>
            <td data-label="Subjects"><div class="subjects-list">${subjectsDisplay}</div></td>
            <td data-label="Duration">${duration}</td>
            <td data-label="Valid Hours">${validityDisplay}</td>
            <td data-label="Questions">${questionsPerSubject}</td>
            <td data-label="Actions" style="position: relative;">
                <button class="action-btn" onclick="toggleCodeDropdown(${index})" style="background: var(--primary-color); color: white; border: none; padding: 8px 12px; border-radius: 4px; cursor: pointer;">
                    ⋮
                </button>
                <div id="codeDropdown_${index}" style="display: none; position: absolute; right: 0; top: 100%; background: white; border: 1px solid var(--border-color); border-radius: 6px; box-shadow: 0 4px 12px rgba(0,0,0,0.15); z-index: 100; min-width: 150px; overflow: hidden;">
                    ${!isExpired ? `<button onclick="editCode(${index}); closeAllCodeDropdowns()" style="width: 100%; padding: 10px 15px; border: none; background: none; text-align: left; cursor: pointer; display: block; border-bottom: 1px solid var(--border-color);">✏️ Edit</button>` : ''}
                    ${!isExpired ? `<button onclick="toggleCodeStatus(${index}); closeAllCodeDropdowns()" style="width: 100%; padding: 10px 15px; border: none; background: none; text-align: left; cursor: pointer; display: block; border-bottom: 1px solid var(--border-color);">${code.active ? '⏸️ Deactivate' : '▶️ Activate'}</button>` : ''}
                    <button onclick="deleteCode(${index}); closeAllCodeDropdowns()" style="width: 100%; padding: 10px 15px; border: none; background: none; text-align: left; cursor: pointer; display: block; color: var(--error-color);">🗑️ Delete</button>
                </div>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

function toggleCodeDropdown(index) {
    const dropdown = document.getElementById(`codeDropdown_${index}`);
    const isVisible = dropdown.style.display === 'block';
    closeAllCodeDropdowns();
    if (!isVisible) {
        dropdown.style.display = 'block';
    }
}

window.closeAllCodeDropdowns = function() {
    document.querySelectorAll('[id^="codeDropdown_"]').forEach(el => {
        el.style.display = 'none';
    });
};

function markCodeAsUsed(code) {
    const codeIndex = AppState.codes.findIndex(c => c.code === code);
    if (codeIndex !== -1) {
        AppState.codes[codeIndex].used = true;
        AppState.codes[codeIndex].usedAt = new Date().toISOString();
        localStorage.setItem('examCodes', JSON.stringify(AppState.codes));
    }
}

function toggleCodeStatus(index) {
    AppState.codes[index].active = !AppState.codes[index].active;
    localStorage.setItem('examCodes', JSON.stringify(AppState.codes));
    renderCodesTable();
}

function deleteCode(index) {
    if (confirm('Are you sure you want to delete this code?')) {
        AppState.codes.splice(index, 1);
        localStorage.setItem('examCodes', JSON.stringify(AppState.codes));
        renderCodesTable();
    }
}

function editCode(index) {
    const code = AppState.codes[index];
    loadSubjects();
    const subjects = AppState.subjects.map(s => s.name);
    const currentSubjects = code.subjects || [];
    const currentDuration = code.duration || 30;
    const currentQuestions = code.questionsPerSubject || 5;
    const currentValidity = code.validityHours || 24;
    const currentAllowReview = code.allowReview !== false;
    
    let modalHtml = `
        <div style="position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.5); display: flex; align-items: center; justify-content: center; z-index: 1000;" onclick="closeEditCodeModal(event)">
            <div style="background: white; border-radius: 12px; padding: 30px; max-width: 500px; width: 90%;">
                <h2 style="margin-bottom: 15px; color: var(--primary-color);">Edit Code: ${code.code}</h2>
                
                <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 15px; margin-bottom: 20px;">
                    <div>
                        <label style="display: block; margin-bottom: 5px; font-weight: 600;">Duration (min)</label>
                        <input type="number" id="editCodeDuration" value="${currentDuration}" min="5" max="180" style="width: 100%; padding: 10px; border: 2px solid var(--border-color); border-radius: 6px;">
                    </div>
                    <div>
                        <label style="display: block; margin-bottom: 5px; font-weight: 600;">Questions/Subject</label>
                        <input type="number" id="editCodeQuestions" value="${currentQuestions}" min="1" max="20" style="width: 100%; padding: 10px; border: 2px solid var(--border-color); border-radius: 6px;">
                    </div>
                    <div>
                        <label style="display: block; margin-bottom: 5px; font-weight: 600;">Valid (hours)</label>
                        <input type="number" id="editCodeValidity" value="${currentValidity}" min="1" max="720" style="width: 100%; padding: 10px; border: 2px solid var(--border-color); border-radius: 6px;">
                    </div>
                </div>
                
                <div style="margin-bottom: 20px;">
                    <label style="display: flex; align-items: center; gap: 10px; padding: 10px; border: 1px solid var(--border-color); border-radius: 6px; cursor: pointer;">
                        <input type="checkbox" id="editCodeReview" ${currentAllowReview ? 'checked' : ''}>
                        <span>Allow students to review answers before submitting</span>
                    </label>
                </div>
                
                <p style="margin-bottom: 10px; font-weight: 600;">Select Subjects:</p>
                <div id="editSubjectList" style="max-height: 200px; overflow-y: auto; margin-bottom: 20px;">
    `;
    
    subjects.forEach(subject => {
        const isChecked = currentSubjects.includes(subject) ? 'checked' : '';
        modalHtml += `
            <label style="display: flex; align-items: center; gap: 10px; padding: 10px; border: 1px solid var(--border-color); border-radius: 6px; margin-bottom: 8px; cursor: pointer;">
                <input type="checkbox" value="${subject}" ${isChecked}>
                <span>${subject}</span>
            </label>
        `;
    });
    
    modalHtml += `
                </div>
                
                <div style="display: flex; gap: 10px;">
                    <button onclick="closeEditCodeModal()" style="flex: 1; padding: 12px; background: var(--border-color); border: none; border-radius: 6px; cursor: pointer;">Cancel</button>
                    <button onclick="saveCodeEdit(${index})" style="flex: 1; padding: 12px; background: var(--primary-color); color: white; border: none; border-radius: 6px; cursor: pointer;">Save Changes</button>
                </div>
            </div>
        </div>
    `;
    
    const existingModal = document.getElementById('editCodeModal');
    if (existingModal) existingModal.remove();
    
    const modalDiv = document.createElement('div');
    modalDiv.id = 'editCodeModal';
    modalDiv.innerHTML = modalHtml;
    document.body.appendChild(modalDiv);
}

function closeEditCodeModal(event) {
    if (!event || event.target === event.currentTarget) {
        const modal = document.getElementById('editCodeModal');
        if (modal) modal.remove();
    }
}

function saveCodeEdit(index) {
    const duration = parseInt(document.getElementById('editCodeDuration').value);
    const questionsPerSubject = parseInt(document.getElementById('editCodeQuestions').value) || 5;
    const validityHours = parseInt(document.getElementById('editCodeValidity').value) || 24;
    const allowReview = document.getElementById('editCodeReview').checked;
    const checkboxes = document.querySelectorAll('#editSubjectList input:checked');
    const selectedSubjects = Array.from(checkboxes).map(cb => cb.value);
    
    if (selectedSubjects.length === 0) {
        alert('Please select at least one subject');
        return;
    }
    
    AppState.codes[index].duration = duration;
    AppState.codes[index].subjects = selectedSubjects;
    AppState.codes[index].questionsPerSubject = questionsPerSubject;
    AppState.codes[index].validityHours = validityHours;
    AppState.codes[index].allowReview = allowReview;
    
    localStorage.setItem('examCodes', JSON.stringify(AppState.codes));
    
    closeEditCodeModal();
    renderCodesTable();
}

function filterCodes() {
    const searchTerm = document.getElementById('searchCode').value.toLowerCase();
    const rows = document.querySelectorAll('#codesTableBody tr');
    
    rows.forEach(row => {
        const code = row.cells[0].textContent.toLowerCase();
        row.style.display = code.includes(searchTerm) ? '' : 'none';
    });
}

function renderResultsList() {
    const container = document.getElementById('resultsList');
    container.innerHTML = '';
    
    loadResults();
    
    if (AppState.results.length === 0) {
        container.innerHTML = '<p style="text-align: center; color: var(--text-light);">No results yet</p>';
        return;
    }
    
    // Group results by date
    const resultsByDate = {};
    AppState.results.forEach((result, idx) => {
        const dateObj = new Date(result.date);
        const dateKey = dateObj.toLocaleDateString();
        if (!resultsByDate[dateKey]) {
            resultsByDate[dateKey] = [];
        }
        resultsByDate[dateKey].push({ ...result, originalIndex: idx });
    });
    
    // Sort dates in descending order
    const sortedDates = Object.keys(resultsByDate).sort((a, b) => new Date(b) - new Date(a));
    
    sortedDates.forEach(dateKey => {
        const dateResults = resultsByDate[dateKey];
        
        // Add date header
        const dateHeader = document.createElement('div');
        dateHeader.style.cssText = 'background: var(--primary-color); color: white; padding: 10px 15px; font-weight: bold; position: sticky; top: 0; z-index: 10;';
        dateHeader.textContent = `📅 ${dateKey} (${dateResults.length} ${dateResults.length === 1 ? 'student' : 'students'})`;
        container.appendChild(dateHeader);
        
        // Add results for this date
        dateResults.forEach(result => {
            const resultIdx = result.originalIndex;
            const dateObj = new Date(result.date);
            const timeStr = dateObj.toLocaleTimeString();
            
            const item = document.createElement('div');
            item.className = 'result-item';
            item.style.cssText = 'padding: 15px; border-bottom: 1px solid var(--border-color); cursor: pointer; background: white;';
            item.onclick = function() { viewDetailedResult(resultIdx); };
            
            item.innerHTML = `
                <div style="display: flex; justify-content: space-between; align-items: center;">
                    <div style="flex: 1;">
                        <strong style="font-size: 1.1rem;">${result.user.fullName || 'Unknown Student'}</strong>
                        <div style="font-size: 0.85rem; color: var(--text-light); margin-top: 4px;">
                            ⏰ ${timeStr} | 📚 ${result.subjects.join(', ')}
                        </div>
                        <div style="font-size: 0.85rem; color: var(--text-light);">
                            📝 Code: ${result.user.examCode}
                        </div>
                    </div>
                    <div style="text-align: right; padding-left: 15px;">
                        <strong style="font-size: 1.3rem; color: var(--primary-color);">${result.totalCorrect}/${result.totalQuestions}</strong>
                        <div style="font-size: 1rem; font-weight: bold; color: ${result.percentage >= 50 ? 'var(--success-color)' : 'var(--error-color)'}; margin-top: 4px;">${result.percentage}%</div>
                    </div>
                </div>
            `;
            
            container.appendChild(item);
        });
    });
}

function exportResultsToExcel() {
    loadResults();
    loadCodes();
    
    if (AppState.results.length === 0) {
        alert('No results to export');
        return;
    }
    
    // Create CSV content
    let csvContent = 'Name,Score,Percentage\n';
    
    AppState.results.forEach(result => {
        const name = (result.user.fullName || '').replace(/,/g, ';');
        const score = result.totalCorrect;
        const percentage = `${result.percentage}%`;
        
        csvContent += `"${name}","${score}","${percentage}"\n`;
    });
    
    // Create and download file
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const timestamp = new Date().toISOString().split('T')[0];
    link.href = URL.createObjectURL(blob);
    link.download = `quiz_results_${timestamp}.csv`;
    link.click();
}

function viewDetailedResult(resultIndex) {
    const result = AppState.results[resultIndex];
    if (!result) return;
    
    let detailContent = `
        <div style="position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.5); display: flex; align-items: center; justify-content: center; z-index: 1000;" onclick="closeDetailModal(event)">
            <div style="background: white; border-radius: 12px; padding: 30px; max-width: 700px; width: 90%; max-height: 80vh; overflow-y: auto;">
                <h2 style="margin-bottom: 10px; color: var(--primary-color);">Student Details</h2>
                <div style="margin-bottom: 20px; padding: 15px; background: #f0f4f8; border-radius: 8px;">
                    <p><strong>Name:</strong> ${result.user.fullName}</p>
                    <p><strong>Email:</strong> ${result.user.email}</p>
                    <p><strong>Phone:</strong> ${result.user.phone || 'N/A'}</p>
                    <p><strong>School:</strong> ${result.user.school || 'N/A'}</p>
                    <p><strong>Exam Code:</strong> ${result.user.examCode}</p>
                    <p><strong>Date:</strong> ${new Date(result.date).toLocaleString()}</p>
                </div>
                
                <h3 style="margin-bottom: 15px;">Score Summary</h3>
                <div style="margin-bottom: 20px; padding: 15px; background: linear-gradient(135deg, var(--primary-color), var(--primary-light)); color: white; border-radius: 8px; text-align: center;">
                    <div style="font-size: 2rem; font-weight: bold;">${result.totalCorrect}/${result.totalQuestions}</div>
                    <div style="font-size: 1.2rem;">${result.percentage}%</div>
                </div>
                
                <h3 style="margin-bottom: 15px;">Subject Breakdown</h3>
    `;
    
    result.subjects.forEach(subject => {
        const score = result.scores[subject];
        const percentage = Math.round((score.correct / score.total) * 100);
        detailContent += `
            <div style="padding: 10px; border-bottom: 1px solid var(--border-color);">
                <div style="display: flex; justify-content: space-between;">
                    <strong>${subject}</strong>
                    <span>${score.correct}/${score.total} (${percentage}%)</span>
                </div>
            </div>
        `;
    });
    
    detailContent += `
                <h3 style="margin: 20px 0 15px;">Answer Details</h3>
    `;
    
    const letters = ['A', 'B', 'C', 'D'];
    let questionNum = 1;
    result.subjects.forEach(subject => {
        const score = result.scores[subject];
        score.questions.forEach(q => {
            const isCorrect = q.isCorrect;
            detailContent += `
                <div style="padding: 12px; margin-bottom: 10px; border-radius: 8px; border-left: 4px solid ${isCorrect ? 'var(--success-color)' : 'var(--error-color)'}; background: ${isCorrect ? '#f0fff4' : '#fff5f5'};">
                    <div style="display: flex; justify-content: space-between; margin-bottom: 8px;">
                        <span style="font-weight: 600;">${questionNum++}. ${q.questionId.replace(subject.toLowerCase().substring(0,3) + '-', '')}</span>
                        <span style="font-weight: 600; color: ${isCorrect ? 'var(--success-color)' : 'var(--error-color)'};">
                            ${isCorrect ? '✓ Correct' : '✗ Wrong'}
                        </span>
                    </div>
                    <div style="font-size: 0.9rem;">
                        <div style="color: ${isCorrect ? 'var(--success-color)' : 'var(--error-color)'};">
                            <strong>Student's Answer:</strong> ${q.userAnswer !== null ? letters[q.userAnswer] : 'Not answered'}
                        </div>
                        ${!isCorrect ? `
                            <div style="color: var(--success-color);">
                                <strong>Correct Answer:</strong> ${letters[q.correctAnswer]}
                            </div>
                        ` : ''}
                    </div>
                </div>
            `;
        });
    });
    
    detailContent += `
                <button onclick="closeDetailModal()" style="margin-top: 20px; padding: 12px 30px; background: var(--primary-color); color: white; border: none; border-radius: 8px; cursor: pointer; width: 100%;">Close</button>
            </div>
        </div>
    `;
    
    // Remove existing modal if any
    const existingModal = document.getElementById('detailModal');
    if (existingModal) existingModal.remove();
    
    // Add modal to page
    const modalDiv = document.createElement('div');
    modalDiv.id = 'detailModal';
    modalDiv.innerHTML = detailContent;
    document.body.appendChild(modalDiv);
}

function closeDetailModal(event) {
    if (!event || event.target === event.currentTarget) {
        const modal = document.getElementById('detailModal');
        if (modal) modal.remove();
    }
}

// ============================================
// NEW QUIZ
// ============================================
function startNewQuiz() {
    // Reset state
    AppState.currentQuestionIndex = 0;
    AppState.questions = [];
    AppState.userAnswers = [];
    AppState.scores = {};
    AppState.isPaused = false;
    AppState.user = {
        fullName: '',
        email: '',
        phone: '',
        school: '',
        examCode: ''
    };
    
    // Clear timer
    clearInterval(AppState.timer);
    document.querySelector('.timer-container').style.background = 'var(--primary-color)';
    
    // Clear form
    document.getElementById('registrationForm').reset();
    
    // Clear user from localStorage and header
    localStorage.removeItem('currentUser');
    localStorage.removeItem('examSession');
    localStorage.removeItem('adminSession');
    
    AppState.adminLoggedIn = false;
    AppState.user = { fullName: '', email: '', phone: '', school: '', examCode: '' };
    AppState.selectedSubjects = [];
    
    document.getElementById('userInfo').style.display = 'none';
    document.getElementById('userName').textContent = '';
    document.getElementById('adminLink').style.display = 'none';
    
    // Show landing
    showScreen('landingScreen');
}

// ============================================
// INITIALIZATION
// ============================================
document.addEventListener('DOMContentLoaded', function() {
    // Initialize codes if not exists
    loadCodes();
    
    // Initialize subjects with default data
    initializeDefaultData();
    loadSubjects();
    
    // Close dropdowns when clicking outside
    document.addEventListener('click', function(event) {
        if (!event.target.closest('td[style*="position"]') && !event.target.closest('button[onclick*="toggleCodeDropdown"]')) {
            closeAllCodeDropdowns();
        }
    });
    
    // Check for saved student session
    const savedUser = localStorage.getItem('currentUser');
    if (savedUser) {
        const user = JSON.parse(savedUser);
        AppState.user = user;
        // Restore exam session if in progress
        const examSession = localStorage.getItem('examSession');
        if (examSession) {
            const session = JSON.parse(examSession);
            AppState.selectedSubjects = session.selectedSubjects;
            AppState.examDuration = session.examDuration;
            AppState.questionsPerSubject = session.questionsPerSubject;
            AppState.allowReview = session.allowReview;
        }
        document.getElementById('userInfo').style.display = 'block';
        document.getElementById('userName').textContent = user.fullName;
    }
    
    // Check for admin session
    const adminSession = localStorage.getItem('adminSession');
    if (adminSession === 'true') {
        loadAdmins();
        AppState.adminLoggedIn = true;
        document.getElementById('adminLink').style.display = 'block';
    }
});
