
/* ============================================================
   CRICKET | INBOUND WORKFLOW ENGINE
   VERSION 1.6

   FEATURES
   ------------------------------------------------------------
   - Guided decision-based workflows
   - One verification per call
   - Animated verification introduction
   - Quick action buttons
   - Expandable detailed instructions
   - Patient-friendly specialty explanations
   - Smart conditional routing
   - Navigation history
   - Automatic documentation generation
   - Editable call documentation
   - Complete Route & Copy Note
   - Unresolved call documentation
   - Shift documentation log
   - Copy shift report
   - New inquiry on the same call
   - New call resets verification
   - Mobile responsive
   - Blue / White / Black theme

   IMPORTANT
   ------------------------------------------------------------
   This is an agent guidance application.
   It does not access patient charts or Zoom directly.

   All information must be verified in approved systems.
   Do not enter PHI into the documentation editor.
   Local shift logs are not a medical record system.
============================================================ */

"use strict";

/* ============================================================
   1. CONFIGURATION
============================================================ */

const CRICKET_CONFIG = {
    version: "1.6",

    animation: {
        enabled: true,
        wordDelay: 75,
        endingDelay: 600
    },

    storage: {
        key: "cricket_shift_v16",
        maxEntries: 250
    }
};

/* ============================================================
   2. CONTACT DIRECTORY
   Verify contact details before production use.
============================================================ */

const CLINIC_DIRECTORY = {
    mainPhone: "404-991-5401",
    fax: "404-991-5403",
    interpreter: "844-579-4374",

    emails: {
        general: "info@neutrauma.com",
        lien: "lien@neutrauma.com",
        records: "records@neutrauma.com",
        settlements: "settlements@neutrauma.com"
    }
};

/* ============================================================
   3. PATIENT VERIFICATION
============================================================ */

const VERIFICATION_SCRIPT =
    "Before we continue, may I please verify your first name, last name, and date of birth? Could you also confirm a good callback number in case our call gets disconnected?";

const VERIFICATION_REQUIREMENTS = [
    "First name",
    "Last name",
    "Date of birth",
    "Good callback number"
];

/* ============================================================
   4. SPECIALTY DEFINITIONS
============================================================ */

const SPECIALTIES = {
    neurology: {
        name: "Neurology",

        simple:
            "Neurology focuses on the brain, nerves, and nervous system.",

        details:
            "A neurologist may evaluate headaches, dizziness, weakness, numbness, or other symptoms involving the nervous system.",

        script:
            "Neurology focuses on how your brain and nerves are functioning. The provider will discuss your symptoms and determine whether additional evaluation or treatment is needed."
    },

    neuropsychology: {
        name: "Neuropsychology",

        simple:
            "Neuropsychology focuses on memory, attention, thinking, and how these relate to brain function.",

        details:
            "The appointment may include an interview and activities evaluating memory, concentration, attention, and problem-solving.",

        script:
            "Neuropsychology helps us understand how your brain is functioning in areas such as memory, focus, and thinking. You may be asked questions or complete some activities during the evaluation."
    },

    vestibular: {
        name: "Vestibular Physical Therapy",

        simple:
            "Vestibular physical therapy helps patients experiencing dizziness and balance difficulties.",

        details:
            "The therapist may assess balance and eye or head movements, and provide exercises appropriate to the patient's symptoms.",

        script:
            "Vestibular physical therapy focuses on dizziness and balance problems. Your therapist may guide you through exercises designed to improve balance and comfort with movement."
    },

    counseling: {
        name: "Counseling",

        simple:
            "Counseling provides professional support for emotional and psychological concerns.",

        details:
            "A counselor can help patients work through stress, anxiety, emotional changes, or difficulties related to injuries or life experiences.",

        script:
            "Counseling gives you an opportunity to speak with a professional about how you're feeling and any challenges you're experiencing. The goal is to provide support and help you manage those challenges."
    }
};

/* ============================================================
   5. ROUTE BUILDERS

   New inbound workflows can reuse these functions.
============================================================ */

function choice(title, description, options, category = "") {
    return {
        type: "choice",
        title,
        description,
        options,
        category
    };
}

function guide(
    title,
    description,
    instructions,
    script,
    actions,
    category = ""
) {
    return {
        type: "guide",
        title,
        description,
        instructions,
        script,
        actions,
        category
    };
}

function finish(
    title,
    description,
    summary,
    status = "resolved"
) {
    return {
        type: "finish",
        title,
        description,
        summary,
        status
    };
}

function option(label, next, event = "", description = "") {
    return {
        label,
        next,
        event,
        description
    };
}

/* ============================================================
   6. APPOINTMENT WORKFLOW
============================================================ */

const APPOINTMENT_WORKFLOW = {

    /* --------------------------------------------------------
       MAIN APPOINTMENT INQUIRY MENU
    -------------------------------------------------------- */

    start: choice(
        "What is the patient calling about?",
        "Select the inquiry that best matches the patient's request.",
        [
            option(
                "When is my appointment?",
                "time",
                "",
                "Confirm appointment date and time"
            ),

            option(
                "What is my appointment for?",
                "type",
                "",
                "Explain appointment specialty"
            ),

            option(
                "Who is my appointment with?",
                "provider",
                "",
                "Confirm provider and specialty"
            ),

            option(
                "How do I join my appointment?",
                "join",
                "",
                "Zoom joining instructions"
            ),

            option(
                "I haven't received my appointment link",
                "missingLink",
                "",
                "Locate and send the appointment link"
            ),

            option(
                "My appointment link isn't working",
                "brokenLink",
                "",
                "Troubleshoot appointment access"
            )
        ],
        "APPOINTMENT INQUIRY"
    ),

    /* --------------------------------------------------------
       ROUTE 1 - APPOINTMENT TIME
    -------------------------------------------------------- */

    time: guide(
        "Confirm Appointment Date & Time",

        "Locate the appointment in the patient's chart.",

        [
            "Open the patient's chart.",
            "Navigate to Appointments.",
            "Locate the appropriate upcoming appointment.",
            "Confirm the appointment date and time.",
            "Check the correct time zone.",
            "Provide the confirmed details to the patient."
        ],

        "Thank you for confirming your information. According to your chart, your appointment is scheduled for [DATE] at [TIME] [TIME ZONE].",

        [
            option(
                "Appointment Time Provided",
                "timeComplete",
                "Provided the confirmed appointment date and time."
            ),

            option(
                "Cannot Locate Appointment",
                "appointmentNotFound",
                "Could not locate the requested appointment."
            )
        ],

        "APPOINTMENT DATE & TIME"
    ),

    timeComplete: finish(
        "Appointment Time Confirmed",
        "The patient received their appointment date and time.",
        "Patient called to confirm when their appointment was scheduled. Verified the patient's identity and callback number, reviewed the appointment in their chart, and provided the confirmed appointment date and time."
    ),

    /* --------------------------------------------------------
       ROUTE 2 - APPOINTMENT TYPE
    -------------------------------------------------------- */

    type: {
        type: "specialty",

        title: "What is the appointment for?",

        description:
            "Check the specialty listed in the patient's chart, then select it below.",

        instructions: [
            "Open the patient's chart.",
            "Navigate to Appointments.",
            "Find the correct appointment.",
            "Identify the listed specialty.",
            "Select that specialty below.",
            "Explain the specialty to the patient."
        ],

        category: "APPOINTMENT SPECIALTY"
    },

    typeComplete: finish(
        "Appointment Specialty Explained",
        "The patient received an explanation of their specialty.",
        "Patient called to ask what their appointment was for. Verified the patient's identity and callback number, checked the appointment specialty in their chart, and provided a patient-friendly explanation."
    ),

    /* --------------------------------------------------------
       ROUTE 3 - APPOINTMENT PROVIDER
    -------------------------------------------------------- */

    provider: guide(
        "Confirm Appointment Provider",

        "Find the provider assigned to the appointment.",

        [
            "Open the patient's chart.",
            "Navigate to Appointments.",
            "Locate the correct appointment.",
            "Confirm the assigned provider's full name.",
            "Confirm the provider's specialty.",
            "Provide this information to the patient."
        ],

        "According to your appointment details, you're scheduled with [PROVIDER NAME], who specializes in [SPECIALTY].",

        [
            option(
                "Provider Information Provided",
                "providerComplete",
                "Provided the confirmed provider name and specialty."
            ),

            option(
                "Provider Information Unavailable",
                "generalPending",
                "Could not verify the assigned provider."
            )
        ],

        "APPOINTMENT PROVIDER"
    ),

    providerComplete: finish(
        "Provider Information Confirmed",
        "The patient received the assigned provider information.",
        "Patient asked who their appointment was with. Verified the patient's identity and callback number, checked the appointment in their chart, and provided the assigned provider's name and specialty."
    ),

    /* --------------------------------------------------------
       ROUTE 4 - JOIN ZOOM
    -------------------------------------------------------- */

    join: guide(
        "How to Join a Zoom Appointment",

        "Walk the patient through accessing their appointment.",

        [
            "Confirm the appointment is scheduled through Zoom.",
            "Ask the patient to locate the message containing the Zoom link.",
            "Have the patient open the link.",
            "Explain how to open Zoom or join through the browser if available.",
            "Help the patient enable microphone/audio permissions.",
            "Explain how to join audio.",
            "Inform them they may be placed in a waiting room."
        ],

        "Please open the message containing your appointment link and tap on it. Follow the prompts to open Zoom and connect your audio. You may be placed in a waiting room until your provider is ready.",

        [
            option(
                "Patient Joined Successfully",
                "joinComplete",
                "Patient confirmed successful Zoom access."
            ),

            option(
                "Patient Doesn't Have the Link",
                "missingLink",
                "Patient reported not receiving their Zoom link."
            ),

            option(
                "Link Isn't Working",
                "brokenLink",
                "Patient reported that the Zoom link was not working."
            )
        ],

        "ZOOM ASSISTANCE"
    ),

    joinComplete: finish(
        "Zoom Appointment Access Successful",
        "The patient was able to access their appointment.",
        "Patient requested assistance joining their Zoom appointment. Verified the patient's identity and callback number, explained the Zoom joining process, and confirmed the patient successfully accessed the appointment."
    ),

    /* --------------------------------------------------------
       ROUTE 5 - MISSING APPOINTMENT LINK
    -------------------------------------------------------- */

    missingLink: guide(
        "Locate & Send Appointment Link",

        "Retrieve the appointment link from the scheduling system.",

        [
            "Go to Schedule.",
            "Click the three-line menu button.",
            "Locate and verify the patient's appointment.",
            "Click the three-dot menu next to the appointment.",
            "Select Appointment Settings.",
            "Find and copy the Zoom appointment link.",
            "Confirm the authorized phone number.",
            "Send the link using the approved messaging system.",
            "Ask the patient whether the link was received."
        ],

        "No problem. I'll locate your appointment link and send it to your confirmed phone number. Please let me know once it arrives.",

        [
            option(
                "Link Received",
                "missingLinkComplete",
                "Sent the appointment link and confirmed receipt."
            ),

            option(
                "Link Received but Doesn't Work",
                "brokenLink",
                "Patient received the appointment link but could not open it."
            ),

            option(
                "Link Not Received",
                "missingLinkRetry",
                "Patient did not receive the appointment link."
            )
        ],

        "MISSING APPOINTMENT LINK"
    ),

    missingLinkRetry: guide(
        "Link Still Not Received",

        "Check the messaging destination and delivery result.",

        [
            "Reconfirm the authorized phone number.",
            "Check the message delivery status.",
            "Ask the patient to check filtered or blocked messages.",
            "Resend using the approved process if appropriate.",
            "Escalate if delivery remains unsuccessful."
        ],

        "Let me double-check the phone number and see whether the message was successfully delivered.",

        [
            option(
                "Patient Received the Link",
                "missingLinkComplete",
                "Resent the link and confirmed successful receipt."
            ),

            option(
                "Still Not Received",
                "missingLinkPending",
                "Link delivery remained unsuccessful and further assistance was required."
            )
        ],

        "LINK DELIVERY"
    ),

    missingLinkComplete: finish(
        "Appointment Link Delivered",
        "The patient confirmed receipt of the link.",
        "Patient called because they had not received their appointment link. Verified the patient's identity and callback number, located the correct appointment link through Schedule and Appointment Settings, sent the link through the approved messaging method, and confirmed receipt."
    ),

    missingLinkPending: finish(
        "Appointment Link Follow-Up Required",
        "The patient did not confirm receipt of the link.",
        "Patient reported not receiving their appointment link. Verified their information, reviewed the appointment and messaging details, and attempted the approved delivery process. Receipt could not be confirmed and further follow-up is required.",
        "pending"
    ),

    /* --------------------------------------------------------
       ROUTE 6 - BROKEN ZOOM LINK
    -------------------------------------------------------- */

    brokenLink: guide(
        "Appointment Link Not Working",

        "Troubleshoot the appointment link and help the patient reconnect.",

        [
            "Confirm the correct appointment.",
            "Ask what happens when the link is opened.",
            "Confirm the patient is using the correct link.",
            "Go to Schedule.",
            "Locate the appointment and open its three-dot menu.",
            "Select Appointment Settings.",
            "Copy the valid link or obtain a replacement through the approved process.",
            "Send it to the patient's confirmed number.",
            "Ask the patient to try joining again."
        ],

        "I'm sorry you're having trouble with your appointment link. Let me check the appointment and send you the correct link so we can try again.",

        [
            option(
                "Link Works Now",
                "brokenLinkComplete",
                "Sent the verified or replacement link and confirmed successful access."
            ),

            option(
                "Still Not Working",
                "phoneAlternative",
                "Zoom access remained unsuccessful after troubleshooting."
            )
        ],

        "ZOOM TROUBLESHOOTING"
    ),

    brokenLinkComplete: finish(
        "Zoom Link Issue Resolved",
        "The patient confirmed successful access.",
        "Patient called because their appointment link was not working. Verified the patient's identity and callback number, reviewed the appointment settings, resent or replaced the link through the approved process, and confirmed the patient could access the appointment."
    ),

    /* --------------------------------------------------------
       TELEPHONE ALTERNATIVE
    -------------------------------------------------------- */

    phoneAlternative: guide(
        "Offer Telephone Appointment",

        "Check whether the provider can conduct the appointment by phone.",

        [
            "Explain that Zoom access is still unsuccessful.",
            "Ask whether the patient is comfortable with a phone appointment.",
            "Confirm their callback number.",
            "Check whether the clinic and provider allow telephone appointments.",
            "Request confirmation through the approved process.",
            "Do not promise a phone call until approval is confirmed."
        ],

        "Since Zoom is still not working, we may be able to arrange for your provider to call you instead. Would you be comfortable with that? I'll need to confirm this option is available.",

        [
            option(
                "Phone Appointment Confirmed",
                "phoneComplete",
                "Provider or authorized team confirmed the telephone appointment."
            ),

            option(
                "Approval Pending",
                "phonePending",
                "Telephone appointment approval remained pending."
            ),

            option(
                "Patient Declined Phone Appointment",
                "phoneDeclined",
                "Patient declined the proposed telephone alternative."
            )
        ],

        "ALTERNATIVE APPOINTMENT"
    ),

    phoneComplete: finish(
        "Telephone Appointment Confirmed",
        "The appointment alternative was approved.",
        "Patient experienced continued Zoom access issues. After troubleshooting, discussed a telephone appointment alternative. The patient agreed, and the provider or authorized scheduling team confirmed the telephone appointment."
    ),

    phonePending: finish(
        "Telephone Appointment Follow-Up",
        "Telephone appointment approval is pending.",
        "Patient experienced continued Zoom access issues. Discussed a possible telephone appointment and requested approval through the appropriate process. The telephone alternative was not yet confirmed and follow-up is required.",
        "pending"
    ),

    phoneDeclined: finish(
        "Alternative Appointment Declined",
        "The patient declined the telephone alternative.",
        "Patient experienced continued Zoom access issues. Offered a possible telephone appointment as an alternative; the patient declined. Further scheduling assistance may be required.",
        "pending"
    ),

    /* --------------------------------------------------------
       GENERAL EXCEPTIONS
    -------------------------------------------------------- */

    appointmentNotFound: finish(
        "Appointment Could Not Be Located",
        "The requested appointment could not be verified.",
        "Patient requested their appointment details. Identity and callback information were verified, but the requested appointment could not be located or confirmed in the chart. Further review is required.",
        "pending"
    ),

    generalPending: finish(
        "Additional Assistance Required",
        "The requested information could not be confirmed.",
        "Patient requested appointment information. Identity and callback information were verified, but the requested details could not be confirmed. Further review is required.",
        "pending"
    )
};

/* ============================================================
   7. CLINIC INFORMATION WORKFLOW
============================================================ */

const CLINIC_WORKFLOW = {

    start: choice(
        "What clinic information does the caller need?",
        "Select the inquiry.",
        [
            option("Phone Number & Fax", "contact"),
            option("Email & Departments", "email"),
            option("Translation Services", "translation")
        ],
        "CLINIC INFORMATION"
    ),

    /* --------------------------------------------------------
       PHONE AND FAX
    -------------------------------------------------------- */

    contact: choice(
        "Which contact detail is needed?",
        "Select the requested contact information.",
        [
            option("Main Phone Number", "mainPhone"),
            option("Fax Number", "fax"),
            option("Department Contact", "email")
        ],
        "CONTACT INFORMATION"
    ),

    mainPhone: guide(
        "Main Phone Number",
        CLINIC_DIRECTORY.mainPhone,
        [
            "Confirm that the general contact number is the information requested.",
            "Provide the verified main phone number."
        ],
        "Our main contact number is " +
            CLINIC_DIRECTORY.mainPhone + ".",
        [
            option(
                "Phone Number Provided",
                "mainPhoneComplete",
                "Provided the main clinic phone number."
            )
        ],
        "CONTACT INFORMATION"
    ),

    mainPhoneComplete: finish(
        "Phone Number Provided",
        "The caller received the contact number.",
        "Caller requested the main clinic phone number. Provided the general contact number."
    ),

    fax: guide(
        "Fax Number",
        CLINIC_DIRECTORY.fax,
        [
            "Confirm the caller needs the general fax number.",
            "Provide the verified fax number.",
            "For protected information, follow the approved recipient verification process."
        ],
        "Our general fax number is " +
            CLINIC_DIRECTORY.fax + ".",
        [
            option(
                "Fax Number Provided",
                "faxComplete",
                "Provided the clinic fax number."
            )
        ],
        "CONTACT INFORMATION"
    ),

    faxComplete: finish(
        "Fax Number Provided",
        "The caller received the fax number.",
        "Caller requested the clinic fax number. Provided the general fax number."
    ),

    /* --------------------------------------------------------
       DEPARTMENT EMAILS
    -------------------------------------------------------- */

    email: choice(
        "Which department does the caller need?",
        "Select the department.",
        [
            option("General Questions & Referrals", "generalEmail"),
            option("Lien / Case Coordination", "lienEmail"),
            option("Medical Records", "recordsEmail"),
            option("Settlements", "settlementEmail")
        ],
        "DEPARTMENT DIRECTORY"
    ),

    generalEmail: guide(
        "General Information & Referrals",
        CLINIC_DIRECTORY.emails.general,
        [
            "Confirm the inquiry is appropriate for General Information or Referrals.",
            "Provide the department email address."
        ],
        "For general inquiries and referrals, you can contact " +
            CLINIC_DIRECTORY.emails.general + ".",
        [
            option(
                "Email Provided",
                "generalEmailComplete",
                "Provided the General Information and Referrals email address."
            )
        ],
        "DEPARTMENT DIRECTORY"
    ),

    generalEmailComplete: finish(
        "General Department Contact Provided",
        "The caller received the department email.",
        "Caller requested General Information or Referrals contact details. Provided the department email address."
    ),

    lienEmail: guide(
        "Lien / Case Coordination",
        CLINIC_DIRECTORY.emails.lien,
        [
            "Confirm the request concerns lien or case coordination.",
            "Provide the appropriate department email.",
            "Do not disclose patient information without authorization."
        ],
        "For lien and case coordination inquiries, you can contact " +
            CLINIC_DIRECTORY.emails.lien + ".",
        [
            option(
                "Email Provided",
                "lienEmailComplete",
                "Provided the Lien and Case Coordination department email."
            )
        ],
        "DEPARTMENT DIRECTORY"
    ),

    lienEmailComplete: finish(
        "Lien Department Contact Provided",
        "The caller received the department email.",
        "Caller requested Lien or Case Coordination contact details. Provided the department email address."
    ),

    recordsEmail: guide(
        "Medical Records",
        CLINIC_DIRECTORY.emails.records,
        [
            "Confirm the caller needs the Medical Records department.",
            "Provide the appropriate email address.",
            "Explain that record requests must follow approved authorization procedures."
        ],
        "For medical records requests, you can contact " +
            CLINIC_DIRECTORY.emails.records + ".",
        [
            option(
                "Email Provided",
                "recordsEmailComplete",
                "Provided the Medical Records contact information."
            )
        ],
        "DEPARTMENT DIRECTORY"
    ),

    recordsEmailComplete: finish(
        "Medical Records Contact Provided",
        "The caller received the records department contact.",
        "Caller requested Medical Records contact information. Provided the department email address and explained that authorization procedures apply."
    ),

    settlementEmail: guide(
        "Settlements",
        CLINIC_DIRECTORY.emails.settlements,
        [
            "Confirm the inquiry concerns settlements.",
            "Provide the Settlements department email address."
        ],
        "For settlement inquiries, you can contact " +
            CLINIC_DIRECTORY.emails.settlements + ".",
        [
            option(
                "Email Provided",
                "settlementEmailComplete",
                "Provided the Settlements department email."
            )
        ],
        "DEPARTMENT DIRECTORY"
    ),

    settlementEmailComplete: finish(
        "Settlements Contact Provided",
        "The caller received the department email.",
        "Caller requested Settlements department contact information. Provided the appropriate email address."
    ),

    /* --------------------------------------------------------
       TRANSLATION SERVICES
    -------------------------------------------------------- */

    translation: choice(
        "Which language assistance is needed?",
        "Select the interpreter route.",
        [
            option("Spanish", "spanish"),
            option("Another Language", "otherLanguage")
        ],
        "LANGUAGE ASSISTANCE"
    ),

    spanish: guide(
        "Spanish Interpreter",
        "Interpreter Number: " +
            CLINIC_DIRECTORY.interpreter +
            " | Press 1",

        [
            "Inform the caller that interpreter assistance will be arranged.",
            "Use the approved call conferencing method.",
            "Dial 844-579-4374.",
            "Press 1 for Spanish according to the reference instructions.",
            "Follow the provider's prompts.",
            "Confirm the interpreter is connected."
        ],

        "I'd be happy to connect an interpreter so we can assist you in Spanish.",

        [
            option(
                "Interpreter Connected",
                "spanishComplete",
                "Connected a Spanish interpreter."
            ),

            option(
                "Unable to Connect Interpreter",
                "interpreterPending",
                "Unable to establish the requested interpreter connection."
            )
        ],

        "LANGUAGE ASSISTANCE"
    ),

    spanishComplete: finish(
        "Spanish Interpreter Connected",
        "Spanish language assistance is connected.",
        "Caller requested Spanish language assistance. Followed the approved interpreter connection process and successfully connected a Spanish interpreter."
    ),

    otherLanguage: guide(
        "Other Language Interpreter",
        "Interpreter Number: " +
            CLINIC_DIRECTORY.interpreter +
            " | Press 2",

        [
            "Ask which language the caller prefers.",
            "Use the approved call conferencing method.",
            "Dial 844-579-4374.",
            "Press 2 for other languages according to the reference instructions.",
            "Follow the provider's prompts.",
            "Confirm the interpreter is connected."
        ],

        "I'd be happy to arrange an interpreter. What language would you prefer?",

        [
            option(
                "Interpreter Connected",
                "otherLanguageComplete",
                "Connected the requested language interpreter."
            ),

            option(
                "Unable to Connect Interpreter",
                "interpreterPending",
                "Unable to establish the requested interpreter connection."
            )
        ],

        "LANGUAGE ASSISTANCE"
    ),

    otherLanguageComplete: finish(
        "Interpreter Connected",
        "The requested interpreter was connected.",
        "Caller requested language assistance. Identified the preferred language, followed the approved interpreter connection process, and successfully connected an interpreter."
    ),

    interpreterPending: finish(
        "Interpreter Assistance Requires Follow-Up",
        "The interpreter could not be connected.",
        "Caller requested language assistance. Attempted to connect an interpreter using the approved process, but the connection could not be completed. Further assistance is required.",
        "pending"
    )
};

/* ============================================================
   8. WORKFLOW REGISTRY

   Future Scheduling Inquiry routes can be added here.
   They automatically gain the same documentation system.
============================================================ */

const WORKFLOWS = {
    appointment: APPOINTMENT_WORKFLOW,
    clinic: CLINIC_WORKFLOW,
    scheduling: null
};

/* ============================================================
   9. APP STATE
============================================================ */

const cricketState = {
    department: null,
    step: null,
    history: [],

    verified: false,
    verificationConfirmedAt: null,

    originalInquiry: null,
    selectedSpecialty: null,

    events: [],

    callStartedAt: null,

    documentationSaved: false,
    currentDraft: ""
};

let animationTimer = null;
let animationSequence = 0;

let shiftLog = loadShiftLog();

/* ============================================================
   10. DOM REFERENCES
============================================================ */

const $ = id => document.getElementById(id);

const selectionScreen = $("selectionScreen");
const routeScreen = $("routeScreen");

const routeCards = document.querySelectorAll(
    ".route-card"
);

const backButton = $("backButton");
const restartButton = $("restartButton");
const breadcrumbInbound = $("breadcrumbInbound");

const routeBreadcrumb = $("routeBreadcrumb");
const activeRouteCategory = $("activeRouteCategory");
const activeRouteTitle = $("activeRouteTitle");
const activeRouteDescription = $("activeRouteDescription");

const workflowContainer = $("workflowContainer");

/* ============================================================
   11. ELEMENT HELPERS
============================================================ */

function createElement(tag, className = "", text = null) {
    const element = document.createElement(tag);

    if (className) {
        element.className = className;
    }

    if (text !== null && text !== undefined) {
        element.textContent = String(text);
    }

    return element;
}

function createButton(text, className, callback) {
    const button = createElement(
        "button",
        className,
        text
    );

    button.type = "button";

    button.addEventListener(
        "click",
        callback
    );

    return button;
}

function createSectionTitle(text) {
    return createElement(
        "h3",
        "clinic-section-heading",
        text
    );
}

function scrollToTop() {
    window.scrollTo({
        top: 0,
        behavior: "instant"
    });
}

function activeWorkflow() {
    return WORKFLOWS[cricketState.department];
}

function escapeNewlines(text) {
    return String(text || "").trim();
}

/* ============================================================
   12. ANIMATION CONTROL
============================================================ */

function cancelAnimation() {
    if (animationTimer !== null) {
        clearTimeout(animationTimer);
        animationTimer = null;
    }

    animationSequence++;
}

/* ============================================================
   13. CLIPBOARD
============================================================ */

async function copyText(text) {
    try {
        if (
            navigator.clipboard &&
            window.isSecureContext
        ) {
            await navigator.clipboard.writeText(text);
            return true;
        }
    } catch (error) {
        console.warn(
            "[Cricket] Clipboard unavailable:",
            error
        );
    }

    const textarea = createElement("textarea");

    textarea.value = text;
    textarea.readOnly = true;

    textarea.style.position = "fixed";
    textarea.style.left = "-9999px";

    document.body.append(textarea);
    textarea.select();

    let copied = false;

    try {
        copied = document.execCommand("copy");
    } catch (error) {
        copied = false;
    }

    textarea.remove();

    return copied;
}

function createCopyButton(
    text,
    label = "Copy",
    className = "clinic-copy-button"
) {
    const button = createButton(
        label,
        className,
        async () => {
            const success = await copyText(text);

            button.textContent = success
                ? "Copied!"
                : "Copy Failed";

            setTimeout(() => {
                if (button.isConnected) {
                    button.textContent = label;
                }
            }, 1600);
        }
    );

    return button;
}

/* ============================================================
   14. CALL LIFECYCLE

   A new call resets verification.

   A new inquiry within the same call keeps verification.
============================================================ */

function resetCallState() {
    cancelAnimation();

    cricketState.department = null;
    cricketState.step = null;
    cricketState.history = [];

    cricketState.verified = false;
    cricketState.verificationConfirmedAt = null;

    cricketState.originalInquiry = null;
    cricketState.selectedSpecialty = null;

    cricketState.events = [];

    cricketState.callStartedAt = null;

    cricketState.documentationSaved = false;
    cricketState.currentDraft = "";
}

function startDepartment(department, sameCall = false) {
    const config = {
        appointment: {
            title: "Appointment Inquiry",
            category: "APPOINTMENTS",
            description:
                "Guided assistance for appointment questions, providers, and Zoom access."
        },

        clinic: {
            title: "Clinic Information",
            category: "CLINIC INFORMATION",
            description:
                "Contact information, departments, and interpreter assistance."
        },

        scheduling: {
            title: "Scheduling Inquiry",
            category: "SCHEDULING",
            description:
                "Guided scheduling and new appointment requests."
        }
    };

    const selected = config[department];

    if (!selected) return;

    const preserveVerification =
        sameCall && cricketState.verified;

    const existingCallStartedAt =
        cricketState.callStartedAt;

    resetCallState();

    if (sameCall) {
        cricketState.verified = preserveVerification;

        cricketState.callStartedAt =
            existingCallStartedAt || new Date().toISOString();
    } else {
        cricketState.callStartedAt =
            new Date().toISOString();
    }

    cricketState.department = department;

    activeRouteCategory.textContent =
        "INBOUND / " + selected.category;

    activeRouteTitle.textContent =
        selected.title;

    activeRouteDescription.textContent =
        selected.description;

    routeBreadcrumb.textContent =
        selected.title;

    routeBreadcrumb.classList.remove("hidden");

    restartButton.hidden = false;

    showScreen("route");

    if (activeWorkflow()) {
        navigateToStep("start", false);
    } else {
        renderSchedulingPlaceholder();
    }

    updateActiveControls();

    scrollToTop();
}

function newInquirySameCall() {
    const currentDepartment =
        cricketState.department;

    if (!currentDepartment) {
        returnToSelection();
        return;
    }

    startDepartment(
        currentDepartment,
        true
    );
}

function newCall() {
    returnToSelection();
}

/* ============================================================
   15. SCREEN NAVIGATION
============================================================ */

function showScreen(name) {
    const screens = {
        selection: selectionScreen,
        route: routeScreen
    };

    const target = screens[name];

    if (!target) return;

    Object.values(screens).forEach(screen => {
        screen.classList.remove("active");
        screen.hidden = true;
    });

    target.hidden = false;
    target.classList.add("active");
}

function navigateToStep(
    stepId,
    saveHistory = true
) {
    const tree = activeWorkflow();

    if (!tree || !tree[stepId]) {
        console.error(
            "[Cricket] Unknown workflow step:",
            stepId
        );
        return;
    }

    cancelAnimation();

    const nextStep = tree[stepId];

    /* Keep verification mandatory before
       appointment information is disclosed. */

    const isAppointment =
        cricketState.department === "appointment";

    const protectedStep =
        nextStep.type === "guide" ||
        nextStep.type === "specialty" ||
        nextStep.type === "finish";

    if (
        isAppointment &&
        protectedStep &&
        !cricketState.verified
    ) {
        console.warn(
            "[Cricket] Verification required."
        );

        return;
    }

    if (
        saveHistory &&
        cricketState.step !== null
    ) {
        cricketState.history.push({
            step: cricketState.step,
            eventCount: cricketState.events.length,
            specialty: cricketState.selectedSpecialty
        });
    }

    cricketState.step = stepId;

    renderWorkflowStep(nextStep);

    updateActiveControls();
    scrollToTop();
}

function navigateChoice(optionData) {
    const tree = activeWorkflow();

    if (!tree || !tree[optionData.next]) {
        return;
    }

    const currentStep = cricketState.step;

    /* Save history before adding new outcomes.
       This lets Back undo a mistaken decision. */

    cricketState.history.push({
        step: currentStep,
        eventCount: cricketState.events.length,
        specialty: cricketState.selectedSpecialty
    });

    if (optionData.event) {
        cricketState.events.push(
            optionData.event
        );
    }

    /* Store the original caller inquiry once. */

    if (
        currentStep === "start" &&
        !cricketState.originalInquiry
    ) {
        cricketState.originalInquiry =
            optionData.label;
    }

    const destination =
        tree[optionData.next];

    /* Verification only happens once per call. */

    if (
        cricketState.department === "appointment" &&
        !cricketState.verified &&
        destination.type !== "choice"
    ) {
        cricketState.step = "__verification__";

        renderVerificationIntro(
            optionData.next
        );

        updateActiveControls();
        scrollToTop();
        return;
    }

    navigateToStep(
        optionData.next,
        false
    );
}

function goBack() {
    cancelAnimation();

    if (cricketState.history.length > 0) {
        const previous =
            cricketState.history.pop();

        cricketState.events.length =
            previous.eventCount;

        cricketState.selectedSpecialty =
            previous.specialty;

        cricketState.step = previous.step;

        const tree = activeWorkflow();

        if (tree && tree[previous.step]) {
            renderWorkflowStep(
                tree[previous.step]
            );
        }

        updateActiveControls();
        scrollToTop();

        return;
    }

    returnToSelection();
}

function returnToSelection() {
    resetCallState();

    routeBreadcrumb.textContent = "";

    routeBreadcrumb.classList.add(
        "hidden"
    );

    restartButton.hidden = true;

    showScreen("selection");

    updateActiveControls();
    scrollToTop();
}

function restartWorkflow() {
    const department =
        cricketState.department;

    if (!department) {
        returnToSelection();
        return;
    }

    /* Start Over means a new call,
       including fresh verification. */

    startDepartment(department, false);
}

/* ============================================================
   16. WORKFLOW RENDERER
============================================================ */

function renderWorkflowStep(step) {
    workflowContainer.replaceChildren();

    const shell = createElement(
        "div",
        "cricket-smart-workflow"
    );

    const header = createElement(
        "div",
        "cricket-smart-header"
    );

    const topRow = createElement(
        "div",
        "cricket-smart-header-top"
    );

    topRow.append(
        createElement(
            "span",
            "cricket-smart-category",
            step.category || "INBOUND WORKFLOW"
        )
    );

    if (
        cricketState.verified &&
        cricketState.department === "appointment"
    ) {
        topRow.append(
            createElement(
                "span",
                "cricket-verified-badge",
                "✓ Patient Verified"
            )
        );
    }

    header.append(
        topRow,
        createElement(
            "h2",
            "cricket-smart-title",
            step.title
        ),
        createElement(
            "p",
            "cricket-smart-description",
            step.description || ""
        )
    );

    shell.append(header);

    switch (step.type) {
        case "choice":
            renderChoiceStep(shell, step);
            break;

        case "guide":
            renderGuideStep(shell, step);
            break;

        case "specialty":
            renderSpecialtyStep(shell, step);
            break;

        case "finish":
            renderFinishStep(shell, step);
            break;
    }

    workflowContainer.append(shell);
}

/* ============================================================
   17. QUICK DECISION BUTTONS
============================================================ */

function renderChoiceStep(shell, step) {
    const body = createElement(
        "div",
        "cricket-smart-body"
    );

    const options = createElement(
        "div",
        "cricket-smart-options"
    );

    step.options.forEach((item, index) => {
        const button = createElement(
            "button",
            "cricket-smart-option"
        );

        button.type = "button";

        const number = createElement(
            "div",
            "cricket-option-number",
            String(index + 1).padStart(2, "0")
        );

        const content = createElement(
            "div",
            "cricket-option-content"
        );

        content.append(
            createElement(
                "strong",
                "",
                item.label
            )
        );

        if (item.description) {
            content.append(
                createElement(
                    "span",
                    "",
                    item.description
                )
            );
        }

        button.append(
            number,
            content,
            createElement(
                "span",
                "cricket-option-arrow",
                "→"
            )
        );

        button.addEventListener(
            "click",
            () => navigateChoice(item)
        );

        options.append(button);
    });

    body.append(
        options,
        createNavigationFooter()
    );

    shell.append(body);
}

/* ============================================================
   18. GUIDED ACTION SCREEN

   One instruction summary.
   One expandable detailed procedure.
   One set of outcome buttons.

   No mandatory instruction checkboxes.
============================================================ */

function renderGuideStep(shell, step) {
    const body = createElement(
        "div",
        "cricket-smart-body"
    );

    const instructions = step.instructions || [];

    /* MAIN ACTION */

    const mainCard = createElement(
        "div",
        "cricket-action-card"
    );

    const actionLabel = createElement(
        "div",
        "cricket-action-label",
        "AGENT ACTION"
    );

    const actionText = createElement(
        "div",
        "cricket-action-text",
        step.description
    );

    mainCard.append(
        actionLabel,
        actionText
    );

    body.append(mainCard);

    /* SCRIPT */

    if (step.script) {
        body.append(
            createAgentScript(step.script)
        );
    }

    /* OPTIONAL DETAILED INSTRUCTIONS */

    if (instructions.length) {
        body.append(
            createExpandableInstructions(
                instructions
            )
        );
    }

    /* QUICK DECISION OUTCOMES */

    const outcomeSection = createElement(
        "div",
        "cricket-outcomes"
    );

    outcomeSection.append(
        createSectionTitle(
            "What happened?"
        )
    );

    const options = createElement(
        "div",
        "cricket-outcome-buttons"
    );

    step.actions.forEach((action, index) => {
        const button = createElement(
            "button",
            "cricket-outcome-button"
        );

        button.type = "button";

        if (index === 0) {
            button.classList.add(
                "primary-outcome"
            );
        }

        const icon = createElement(
            "span",
            "cricket-outcome-icon",
            index === 0 ? "✓" : "→"
        );

        button.append(
            icon,
            createElement(
                "span",
                "",
                action.label
            )
        );

        button.addEventListener(
            "click",
            () => navigateChoice(action)
        );

        options.append(button);
    });

    outcomeSection.append(options);

    body.append(
        outcomeSection,
        createNavigationFooter()
    );

    shell.append(body);
}

/* ============================================================
   19. EXPANDABLE INSTRUCTIONS
============================================================ */

function createExpandableInstructions(items) {
    const details = createElement(
        "details",
        "cricket-instructions"
    );

    const summary = createElement(
        "summary",
        "",
        "View Detailed Instructions"
    );

    const list = createElement(
        "ol",
        "cricket-instruction-list"
    );

    items.forEach(text => {
        list.append(
            createElement("li", "", text)
        );
    });

    details.append(summary, list);

    return details;
}

/* ============================================================
   20. AGENT SCRIPT CARD
============================================================ */

function createAgentScript(script) {
    const card = createElement(
        "div",
        "cricket-agent-script"
    );

    const header = createElement(
        "div",
        "cricket-agent-script-header"
    );

    header.append(
        createElement(
            "span",
            "",
            "SAY TO THE PATIENT"
        ),
        createCopyButton(
            script,
            "Copy Script",
            "cricket-small-copy"
        )
    );

    card.append(
        header,
        createElement(
            "p",
            "",
            "“" + script + "”"
        )
    );

    return card;
}

/* ============================================================
   21. SPECIALTY EXPLANATIONS
============================================================ */

function renderSpecialtyStep(shell, step) {
    const body = createElement(
        "div",
        "cricket-smart-body"
    );

    body.append(
        createExpandableInstructions(
            step.instructions || []
        )
    );

    const buttons = createElement(
        "div",
        "cricket-specialty-buttons"
    );

    const display = createElement(
        "div",
        "cricket-specialty-display"
    );

    const continueButton = createButton(
        "Explanation Provided →",
        "cricket-main-action",
        () => {
            if (!cricketState.selectedSpecialty) {
                return;
            }

            navigateChoice({
                label: "Specialty explanation provided",
                next: "typeComplete",
                event:
                    "Explained the " +
                    cricketState.selectedSpecialty +
                    " specialty to the patient."
            });
        }
    );

    continueButton.disabled = true;

    Object.entries(SPECIALTIES).forEach(
        ([id, specialty]) => {
            const button = createButton(
                specialty.name,
                "cricket-specialty-button",
                () => {
                    cricketState.selectedSpecialty =
                        specialty.name;

                    buttons.querySelectorAll("button")
                        .forEach(item => {
                            item.classList.remove(
                                "selected"
                            );

                            item.setAttribute(
                                "aria-pressed",
                                "false"
                            );
                        });

                    button.classList.add(
                        "selected"
                    );

                    button.setAttribute(
                        "aria-pressed",
                        "true"
                    );

                    display.replaceChildren();

                    const card = createElement(
                        "div",
                        "cricket-specialty-card"
                    );

                    card.append(
                        createElement(
                            "h3",
                            "",
                            specialty.name
                        ),
                        createElement(
                            "p",
                            "cricket-specialty-simple",
                            specialty.simple
                        ),
                        createElement(
                            "p",
                            "cricket-specialty-detail",
                            specialty.details
                        ),
                        createAgentScript(
                            specialty.script
                        )
                    );

                    display.append(card);

                    continueButton.disabled = false;
                }
            );

            button.setAttribute(
                "aria-pressed",
                "false"
            );

            buttons.append(button);
        }
    );

    body.append(
        createSectionTitle(
            "Select Appointment Specialty"
        ),
        buttons,
        display
    );

    const actions = createElement(
        "div",
        "cricket-outcome-buttons"
    );

    actions.append(
        continueButton,
        createButton(
            "Specialty Could Not Be Verified",
            "cricket-secondary-action",
            () => {
                navigateChoice({
                    label: "Specialty unavailable",
                    next: "generalPending",
                    event:
                        "Could not verify the appointment specialty."
                });
            }
        )
    );

    body.append(
        actions,
        createNavigationFooter()
    );

    shell.append(body);
}

/* ============================================================
   22. WORD-BY-WORD VERIFICATION

   One verification per call.

   The script animates first.
   Then a single agent attestation appears.

   The agent must actually verify the details
   in the approved patient system.
============================================================ */

function renderVerificationIntro(destination) {
    cancelAnimation();

    workflowContainer.replaceChildren();

    const shell = createElement(
        "div",
        "cricket-verification-screen"
    );

    const label = createElement(
        "div",
        "cricket-smart-category",
        "PATIENT VERIFICATION"
    );

    const heading = createElement(
        "h2",
        "cricket-verification-heading",
        "Say to the patient"
    );

    const animated = createElement(
        "div",
        "cricket-verification-animated"
    );

    animated.setAttribute(
        "aria-label",
        VERIFICATION_SCRIPT
    );

    const words = VERIFICATION_SCRIPT.split(" ");

    words.forEach((word, index) => {
        const span = createElement(
            "span",
            "cricket-verification-word",
            word
        );

        span.setAttribute(
            "aria-hidden",
            "true"
        );

        span.style.animationDelay =
            (
                index *
                CRICKET_CONFIG.animation.wordDelay
            ) + "ms";

        animated.append(span);

        if (index < words.length - 1) {
            animated.append(
                document.createTextNode(" ")
            );
        }
    });

    const verificationPanel = createElement(
        "div",
        "cricket-verify-panel"
    );

    verificationPanel.hidden = true;

    verificationPanel.append(
        createElement(
            "h3",
            "",
            "Confirm Verification"
        ),
        createElement(
            "p",
            "",
            "Verify all four details using the approved patient chart before continuing."
        )
    );

    const requirements = createElement(
        "div",
        "cricket-verify-requirements"
    );

    VERIFICATION_REQUIREMENTS.forEach(item => {
        requirements.append(
            createElement(
                "span",
                "",
                "✓ " + item
            )
        );
    });

    verificationPanel.append(requirements);

    const attestationLabel = createElement(
        "label",
        "cricket-attestation"
    );

    const attestationCheckbox =
        document.createElement("input");

    attestationCheckbox.type = "checkbox";

    attestationLabel.append(
        attestationCheckbox,
        createElement(
            "span",
            "",
            "I have verified the patient's first name, last name, date of birth, and callback number in the approved system."
        )
    );

    const continueButton = createButton(
        "Patient Verified — Continue →",
        "cricket-main-action",
        () => {
            if (!attestationCheckbox.checked) {
                return;
            }

            cricketState.verified = true;

            cricketState.verificationConfirmedAt =
                new Date().toISOString();

            cricketState.events.push(
                "Verified the patient's identity and callback number."
            );

            navigateToStep(
                destination,
                false
            );
        }
    );

    continueButton.disabled = true;

    attestationCheckbox.addEventListener(
        "change",
        () => {
            continueButton.disabled =
                !attestationCheckbox.checked;
        }
    );

    verificationPanel.append(
        attestationLabel,
        continueButton
    );

    const skip = createButton(
        "Skip Animation →",
        "cricket-skip-button",
        finishAnimation
    );

    const controls = createElement(
        "div",
        "cricket-verification-controls"
    );

    controls.append(
        skip,
        createButton(
            "← Previous",
            "cricket-secondary-action",
            goBack
        )
    );

    shell.append(
        label,
        heading,
        animated,
        controls,
        verificationPanel
    );

    workflowContainer.append(shell);

    const sequence = animationSequence;
    let finished = false;

    function finishAnimation() {
        if (
            finished ||
            sequence !== animationSequence
        ) {
            return;
        }

        finished = true;

        clearTimeout(animationTimer);
        animationTimer = null;

        animated.querySelectorAll(
            ".cricket-verification-word"
        ).forEach(span => {
            span.style.opacity = "1";
            span.style.filter = "none";
            span.style.transform = "none";
            span.style.animation = "none";
        });

        verificationPanel.hidden = false;
        skip.remove();
    }

    const reducedMotion = window.matchMedia(
        "(prefers-reduced-motion: reduce)"
    ).matches;

    if (
        reducedMotion ||
        !CRICKET_CONFIG.animation.enabled
    ) {
        finishAnimation();
    } else {
        animationTimer = setTimeout(
            finishAnimation,
            (
                words.length *
                CRICKET_CONFIG.animation.wordDelay
            ) +
            CRICKET_CONFIG.animation.endingDelay
        );
    }
}

/* ============================================================
   23. COMPLETION SCREEN
============================================================ */

function renderFinishStep(shell, step) {
    const body = createElement(
        "div",
        "cricket-smart-body"
    );

    const pending =
        step.status === "pending";

    const result = createElement(
        "div",
        "cricket-completion-result"
    );

    result.append(
        createElement(
            "div",
            "cricket-completion-icon",
            pending ? "!" : "✓"
        ),
        createElement(
            "h3",
            "",
            pending
                ? "Follow-Up Required"
                : "Workflow Complete"
        ),
        createElement(
            "p",
            "",
            step.description
        )
    );

    if (pending) {
        result.classList.add(
            "pending"
        );
    }

    body.append(result);

    const documentation =
        generateDocumentation(step);

    body.append(
        createDocumentationEditor(
            documentation,
            step.status || "resolved"
        )
    );

    body.append(
        createNavigationFooter()
    );

    shell.append(body);
}

/* ============================================================
   24. DOCUMENTATION ENGINE

   Generates notes based on the outcome that
   the agent selected.

   This avoids documenting every instruction
   as completed without confirmation.
============================================================ */

function generateDocumentation(step, unresolved = false) {
    const original =
        cricketState.originalInquiry ||
        "General inbound inquiry";

    const departmentNames = {
        appointment: "appointment",
        clinic: "clinic information",
        scheduling: "scheduling"
    };

    const department =
        departmentNames[cricketState.department] ||
        "inbound";

    if (unresolved) {
        const lastAction =
            cricketState.events.length
                ? cricketState.events[
                    cricketState.events.length - 1
                ]
                : "The inquiry was not fully resolved.";

        const verification =
            cricketState.verified
                ? "Patient identity and callback information were verified. "
                : "";

        return (
            "Caller contacted the " +
            department +
            " department regarding: " +
            original +
            ".\n\n" +
            verification +
            lastAction +
            "\n\nThe inquiry was not fully resolved during the call. Further review or follow-up may be required."
        );
    }

    let note = step.summary || (
        "Caller contacted the " +
        department +
        " department regarding " +
        original.toLowerCase() +
        ". Assistance was provided."
    );

    if (
        cricketState.selectedSpecialty &&
        cricketState.department === "appointment" &&
        cricketState.step === "typeComplete"
    ) {
        note +=
            " Specialty explained: " +
            cricketState.selectedSpecialty +
            ".";
    }

    return note;
}

/* ============================================================
   25. DOCUMENTATION EDITOR
============================================================ */

function createDocumentationEditor(note, status) {
    const container = createElement(
        "div",
        "cricket-doc-container"
    );

    container.append(
        createElement(
            "div",
            "cricket-smart-category",
            "AUTOMATIC CALL DOCUMENTATION"
        ),
        createElement(
            "h3",
            "",
            "Generated Call Summary"
        ),
        createElement(
            "p",
            "cricket-doc-help",
            "Review this summary before completing the route. Only document actions that actually occurred. Do not include patient identifiers."
        )
    );

    const editor = createElement(
        "textarea",
        "cricket-doc-editor"
    );

    editor.value = note;
    editor.rows = 6;

    editor.setAttribute(
        "aria-label",
        "Generated call documentation"
    );

    container.append(editor);

    const confirmation = createElement(
        "label",
        "cricket-doc-confirmation"
    );

    const checkbox =
        document.createElement("input");

    checkbox.type = "checkbox";

    confirmation.append(
        checkbox,
        createElement(
            "span",
            "",
            "I confirm this summary accurately reflects the call and contains no patient-identifying information."
        )
    );

    container.append(confirmation);

    const actions = createElement(
        "div",
        "cricket-doc-actions"
    );

    const complete = createButton(
        status === "pending"
            ? "Document Call & Copy Note"
            : "Complete Route & Copy Note",
        "cricket-main-action",
        async () => {
            if (!checkbox.checked) return;

            const finalNote =
                escapeNewlines(editor.value);

            if (!finalNote) {
                editor.focus();
                return;
            }

            if (cricketState.documentationSaved) {
                return;
            }

            cricketState.documentationSaved = true;

            complete.disabled = true;

            saveCompletedCall(
                finalNote,
                status
            );

            const copied =
                await copyText(finalNote);

            complete.textContent = copied
                ? "Route Saved & Note Copied!"
                : "Route Saved — Select & Copy";

            if (!copied) {
                editor.focus();
                editor.select();
            }

            displayNextCallActions(
                container
            );
        }
    );

    complete.disabled = true;

    checkbox.addEventListener(
        "change",
        () => {
            complete.disabled =
                !checkbox.checked;
        }
    );

    const copyDraft = createButton(
        "Copy Draft",
        "cricket-secondary-action",
        async () => {
            const copied = await copyText(
                editor.value
            );

            copyDraft.textContent =
                copied
                    ? "Draft Copied!"
                    : "Copy Failed";

            setTimeout(() => {
                copyDraft.textContent =
                    "Copy Draft";
            }, 1600);
        }
    );

    actions.append(
        complete,
        copyDraft
    );

    container.append(actions);

    return container;
}

/* ============================================================
   26. POST-CALL ACTIONS
============================================================ */

function displayNextCallActions(container) {
    const actions = createElement(
        "div",
        "cricket-next-call-actions"
    );

    actions.append(
        createButton(
            "Another Inquiry — Same Call",
            "cricket-main-action",
            newInquirySameCall
        ),

        createButton(
            "Start New Call",
            "cricket-secondary-action",
            newCall
        ),

        createButton(
            "View Shift Log",
            "cricket-secondary-action",
            openShiftPanel
        )
    );

    container.append(actions);
}

/* ============================================================
   27. UNRESOLVED CALL HANDLING
============================================================ */

function documentUnresolvedCall() {
    if (!cricketState.department) {
        return;
    }

    cancelAnimation();

    workflowContainer.replaceChildren();

    const shell = createElement(
        "div",
        "cricket-smart-workflow"
    );

    const header = createElement(
        "div",
        "cricket-smart-header"
    );

    header.append(
        createElement(
            "span",
            "cricket-smart-category",
            "CALL DOCUMENTATION"
        ),
        createElement(
            "h2",
            "cricket-smart-title",
            "Document Unresolved Call"
        ),
        createElement(
            "p",
            "cricket-smart-description",
            "Document what actually happened during the call and whether follow-up is needed."
        )
    );

    const body = createElement(
        "div",
        "cricket-smart-body"
    );

    const note = generateDocumentation(
        {},
        true
    );

    body.append(
        createDocumentationEditor(
            note,
            "pending"
        )
    );

    body.append(
        createNavigationFooter()
    );

    shell.append(
        header,
        body
    );

    workflowContainer.append(shell);
    scrollToTop();
}

/* ============================================================
   28. NAVIGATION FOOTER
============================================================ */

function createNavigationFooter() {
    const footer = createElement(
        "div",
        "cricket-navigation-footer"
    );

    footer.append(
        createButton(
            "← Previous",
            "cricket-back-button",
            goBack
        )
    );

    return footer;
}

/* ============================================================
   29. SHIFT STORAGE

   Session storage holds generic call notes only.

   It is not permanent employee documentation.
============================================================ */

function loadShiftLog() {
    try {
        const raw = sessionStorage.getItem(
            CRICKET_CONFIG.storage.key
        );

        const parsed = raw
            ? JSON.parse(raw)
            : [];

        return Array.isArray(parsed)
            ? parsed.filter(item =>
                item &&
                typeof item.note === "string" &&
                typeof item.date === "string"
            )
            : [];
    } catch (error) {
        return [];
    }
}

function persistShiftLog() {
    try {
        sessionStorage.setItem(
            CRICKET_CONFIG.storage.key,
            JSON.stringify(shiftLog)
        );
    } catch (error) {
        console.warn(
            "[Cricket] Could not save shift log.",
            error
        );
    }

    updateShiftCounter();
}

function saveCompletedCall(note, status) {
    if (
        shiftLog.length >=
        CRICKET_CONFIG.storage.maxEntries
    ) {
        shiftLog.shift();
    }

    const departmentNames = {
        appointment: "Appointment Inquiry",
        clinic: "Clinic Information",
        scheduling: "Scheduling Inquiry"
    };

    shiftLog.push({
        id:
            Date.now().toString() +
            "-" +
            shiftLog.length,

        date: new Date().toISOString(),

        department:
            departmentNames[cricketState.department] ||
            "Inbound",

        inquiry:
            cricketState.originalInquiry ||
            "General Inquiry",

        status,

        note
    });

    persistShiftLog();
    renderShiftLog();
}

/* ============================================================
   30. SHIFT REPORT GENERATION
============================================================ */

function generateShiftReport() {
    const resolved = shiftLog.filter(
        entry => entry.status === "resolved"
    ).length;

    const pending = shiftLog.filter(
        entry => entry.status !== "resolved"
    ).length;

    const lines = [
        "CRICKET - INBOUND SHIFT REPORT",
        "Generated: " + new Date().toLocaleString(),
        "",
        "Total Documented Calls: " + shiftLog.length,
        "Resolved: " + resolved,
        "Pending / Follow-Up: " + pending,
        "",
        "====================================="
    ];

    shiftLog.forEach((entry, index) => {
        lines.push(
            "",
            "CALL " + (index + 1),
            "Time: " + new Date(entry.date).toLocaleString(),
            "Section: " + entry.department,
            "Inquiry: " + entry.inquiry,
            "Status: " + entry.status.toUpperCase(),
            "",
            entry.note,
            "",
            "-------------------------------------"
        );
    });

    return lines.join("\n");
}

/* ============================================================
   31. SHIFT PANEL
============================================================ */

function createShiftPanel() {
    const toggle = createButton(
        "Shift Log (0)",
        "cricket-shift-toggle",
        toggleShiftPanel
    );

    toggle.id = "cricketShiftToggle";

    const panel = createElement(
        "aside",
        "cricket-shift-panel"
    );

    panel.id = "cricketShiftPanel";

    panel.setAttribute(
        "aria-label",
        "Cricket shift documentation"
    );

    const header = createElement(
        "div",
        "cricket-shift-header"
    );

    header.append(
        createElement(
            "h3",
            "",
            "Inbound Shift Log"
        ),

        createButton(
            "×",
            "cricket-shift-close",
            closeShiftPanel
        )
    );

    const description = createElement(
        "p",
        "cricket-shift-description",
        "Completed call summaries for this browser session. Review and copy them to your approved documentation system before ending your shift."
    );

    const entries = createElement(
        "div",
        "cricket-shift-entries"
    );

    entries.id = "cricketShiftEntries";

    const actions = createElement(
        "div",
        "cricket-shift-actions"
    );

    actions.append(
        createButton(
            "Copy Shift Report",
            "cricket-main-action",
            async event => {
                const copied = await copyText(
                    generateShiftReport()
                );

                event.currentTarget.textContent =
                    copied
                        ? "Report Copied!"
                        : "Copy Failed";
            }
        ),

        createButton(
            "Clear Shift",
            "cricket-secondary-action",
            clearShiftLog
        )
    );

    panel.append(
        header,
        description,
        entries,
        actions
    );

    document.body.append(
        toggle,
        panel
    );

    renderShiftLog();
}

function openShiftPanel() {
    const panel = $("cricketShiftPanel");

    if (panel) {
        panel.classList.add("open");
    }
}

function closeShiftPanel() {
    const panel = $("cricketShiftPanel");

    if (panel) {
        panel.classList.remove("open");
    }
}

function toggleShiftPanel() {
    const panel = $("cricketShiftPanel");

    if (panel) {
        panel.classList.toggle("open");
    }
}

function updateShiftCounter() {
    const toggle = $("cricketShiftToggle");

    if (toggle) {
        toggle.textContent =
            "Shift Log (" + shiftLog.length + ")";
    }
}

function renderShiftLog() {
    const list = $("cricketShiftEntries");

    if (!list) return;

    list.replaceChildren();

    if (shiftLog.length === 0) {
        list.append(
            createElement(
                "div",
                "cricket-shift-empty",
                "No documented calls yet."
            )
        );

        updateShiftCounter();
        return;
    }

    [...shiftLog].reverse().forEach(entry => {
        const card = createElement(
            "div",
            "cricket-shift-entry"
        );

        card.append(
            createElement(
                "span",
                "cricket-shift-time",
                new Date(entry.date).toLocaleString()
            ),

            createElement(
                "strong",
                "",
                entry.department
            ),

            createElement(
                "p",
                "",
                entry.note
            ),

            createCopyButton(
                entry.note,
                "Copy Note",
                "cricket-small-copy"
            )
        );

        list.append(card);
    });

    updateShiftCounter();
}

function clearShiftLog() {
    if (!shiftLog.length) return;

    const confirmed = window.confirm(
        "Clear this shift's documentation? This cannot be undone."
    );

    if (!confirmed) return;

    shiftLog = [];

    persistShiftLog();
    renderShiftLog();
}

/* ============================================================
   32. SCHEDULING PLACEHOLDER

   Future scheduling routes will use the same
   guided-action and documentation engine.

   No scheduling procedures are invented here.
============================================================ */

function renderSchedulingPlaceholder() {
    workflowContainer.replaceChildren();

    const shell = createElement(
        "div",
        "cricket-smart-workflow"
    );

    const body = createElement(
        "div",
        "cricket-smart-body"
    );

    body.append(
        createElement(
            "div",
            "cricket-smart-category",
            "SCHEDULING INQUIRY"
        ),

        createElement(
            "h2",
            "cricket-smart-title",
            "Scheduling Workflow"
        ),

        createElement(
            "p",
            "cricket-smart-description",
            "Scheduling routes are ready to be configured. They will automatically support guided decisions, verification, and call documentation."
        ),

        createButton(
            "Document Scheduling Inquiry",
            "cricket-main-action",
            documentUnresolvedCall
        )
    );

    shell.append(body);
    workflowContainer.append(shell);
}

/* ============================================================
   33. ACTIVE CONTROLS
============================================================ */

function installEndCallButton() {
    const button = createButton(
        "End Call / Document",
        "cricket-end-call-button",
        documentUnresolvedCall
    );

    button.id = "cricketEndCall";
    button.hidden = true;

    const target = document.querySelector(
        ".workflow-top"
    );

    if (target) {
        target.append(button);
    }
}

function updateActiveControls() {
    const button = $("cricketEndCall");

    if (button) {
        button.hidden =
            !cricketState.department;
    }
}

/* ============================================================
   34. SMART WORKFLOW STYLES

   Injected automatically.
   No changes to inbound.css are required.
============================================================ */

function installSmartStyles() {
    const style = createElement("style");

    style.id = "cricketSmartStyles";

    style.textContent = `

/* ==========================================
   CRICKET v1.6 - SMART WORKFLOW
========================================== */

.cricket-smart-workflow {
    background: #ffffff;
    border: 1px solid #e2e8f0;
    border-radius: 16px;
    overflow: hidden;
    box-shadow: 0 5px 25px rgba(15,23,42,.035);
    animation: cricketSmartEnter .25s ease both;
}

@keyframes cricketSmartEnter {
    from {
        opacity: 0;
        transform: translateY(7px);
    }
    to {
        opacity: 1;
        transform: translateY(0);
    }
}

.cricket-smart-header {
    padding: 32px 36px 27px;
    border-bottom: 1px solid #e2e8f0;
}

.cricket-smart-header-top {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 12px;
    flex-wrap: wrap;
    margin-bottom: 13px;
}

.cricket-smart-category {
    display: block;
    font: 800 10px 'DM Sans',sans-serif;
    color: #2563eb;
    letter-spacing: 1.8px;
    text-transform: uppercase;
}

.cricket-verified-badge {
    font: 700 11px 'DM Sans',sans-serif;
    color: #1d4ed8;
    background: #eff6ff;
    border: 1px solid #bfdbfe;
    border-radius: 25px;
    padding: 7px 11px;
}

.cricket-smart-title {
    font: 600 clamp(24px,3vw,33px) 'Space Grotesk',sans-serif;
    letter-spacing: -1px;
    color: #111827;
    margin: 12px 0;
}

.cricket-smart-description {
    color: #64748b;
    font: 13px/1.8 'DM Sans',sans-serif;
    margin: 0;
}

.cricket-smart-body {
    padding: 32px 36px 36px;
}

/* ==========================================
   QUICK CHOICES
========================================== */

.cricket-smart-options {
    display: grid;
    gap: 11px;
}

.cricket-smart-option {
    display: flex;
    align-items: center;
    gap: 17px;
    width: 100%;
    min-height: 76px;
    padding: 17px 20px;
    background: #ffffff;
    border: 1px solid #e2e8f0;
    border-radius: 11px;
    text-align: left;
    cursor: pointer;
    transition: .18s ease;
}

.cricket-smart-option:hover {
    border-color: #93c5fd;
    background: #eff6ff;
    transform: translateX(3px);
}

.cricket-option-number {
    display: grid;
    place-items: center;
    flex-shrink: 0;
    width: 39px;
    height: 39px;
    background: #f1f5f9;
    border-radius: 9px;
    font: 700 12px 'Space Grotesk',sans-serif;
    color: #64748b;
}

.cricket-smart-option:hover .cricket-option-number {
    background: #dbeafe;
    color: #2563eb;
}

.cricket-option-content {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 6px;
}

.cricket-option-content strong {
    color: #111827;
    font: 700 14px 'DM Sans',sans-serif;
}

.cricket-option-content span {
    color: #64748b;
    font: 12px/1.6 'DM Sans',sans-serif;
}

.cricket-option-arrow {
    color: #94a3b8;
    font-size: 21px;
}

.cricket-smart-option:hover .cricket-option-arrow {
    color: #2563eb;
}

/* ==========================================
   ACTION CARD
========================================== */

.cricket-action-card {
    background: #f8fafc;
    border: 1px solid #e2e8f0;
    border-radius: 12px;
    padding: 23px;
    margin-bottom: 20px;
}

.cricket-action-label {
    color: #2563eb;
    font: 800 10px 'DM Sans',sans-serif;
    letter-spacing: 1.5px;
    margin-bottom: 11px;
}

.cricket-action-text {
    color: #111827;
    font: 600 18px/1.65 'Space Grotesk',sans-serif;
}

/* ==========================================
   AGENT SCRIPT
========================================== */

.cricket-agent-script {
    background: #eff6ff;
    border: 1px solid #dbeafe;
    border-left: 3px solid #2563eb;
    border-radius: 11px;
    padding: 22px;
    margin-bottom: 22px;
}

.cricket-agent-script-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 15px;
}

.cricket-agent-script-header > span {
    color: #2563eb;
    font: 800 10px 'DM Sans',sans-serif;
    letter-spacing: 1.5px;
}

.cricket-agent-script p {
    margin: 0;
    color: #1e40af;
    font: 500 14px/1.9 'DM Sans',sans-serif;
}

.cricket-small-copy {
    padding: 8px 11px;
    background: #ffffff;
    border: 1px solid #bfdbfe;
    border-radius: 7px;
    color: #2563eb;
    font: 700 11px 'DM Sans',sans-serif;
    cursor: pointer;
}

/* ==========================================
   EXPANDABLE INSTRUCTIONS
========================================== */

.cricket-instructions {
    border: 1px solid #e2e8f0;
    border-radius: 10px;
    background: #ffffff;
    margin: 17px 0 27px;
    overflow: hidden;
}

.cricket-instructions summary {
    padding: 17px 20px;
    font: 700 12px 'DM Sans',sans-serif;
    color: #2563eb;
    cursor: pointer;
}

.cricket-instructions[open] summary {
    background: #f8fafc;
    border-bottom: 1px solid #e2e8f0;
}

.cricket-instruction-list {
    padding: 12px 25px 18px 43px;
    margin: 0;
}

.cricket-instruction-list li {
    padding: 8px 0;
    color: #475569;
    font: 13px/1.7 'DM Sans',sans-serif;
}

/* ==========================================
   OUTCOME BUTTONS
========================================== */

.cricket-outcomes h3 {
    font: 600 18px 'Space Grotesk',sans-serif;
    color: #111827;
    margin: 0 0 16px;
}

.cricket-outcome-buttons {
    display: flex;
    flex-direction: column;
    gap: 10px;
}

.cricket-outcome-button {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 16px 19px;
    min-height: 55px;
    background: #ffffff;
    border: 1px solid #e2e8f0;
    border-radius: 10px;
    text-align: left;
    cursor: pointer;
    color: #334155;
    font: 700 13px 'DM Sans',sans-serif;
    transition: .18s ease;
}

.cricket-outcome-button:hover {
    background: #eff6ff;
    border-color: #93c5fd;
    color: #2563eb;
}

.cricket-outcome-button.primary-outcome {
    background: #eff6ff;
    border-color: #bfdbfe;
    color: #1d4ed8;
}

.cricket-outcome-button.primary-outcome:hover {
    background: #dbeafe;
}

.cricket-outcome-icon {
    display: grid;
    place-items: center;
    width: 27px;
    height: 27px;
    flex-shrink: 0;
    border-radius: 8px;
    background: #f1f5f9;
    color: #2563eb;
}

/* ==========================================
   NAVIGATION
========================================== */

.cricket-navigation-footer {
    display: flex;
    justify-content: flex-start;
    margin-top: 26px;
    padding-top: 20px;
    border-top: 1px solid #e2e8f0;
}

.cricket-back-button,
.cricket-secondary-action {
    background: #ffffff;
    border: 1px solid #e2e8f0;
    border-radius: 9px;
    padding: 12px 17px;
    color: #475569;
    font: 700 12px 'DM Sans',sans-serif;
    cursor: pointer;
    transition: .2s ease;
}

.cricket-back-button:hover,
.cricket-secondary-action:hover {
    background: #eff6ff;
    border-color: #bfdbfe;
    color: #2563eb;
}

.cricket-main-action {
    background: #2563eb;
    border: 1px solid #2563eb;
    border-radius: 9px;
    padding: 13px 19px;
    color: #ffffff;
    font: 700 12px 'DM Sans',sans-serif;
    cursor: pointer;
    transition: .2s ease;
}

.cricket-main-action:hover {
    background: #1d4ed8;
}

.cricket-main-action:disabled {
    background: #cbd5e1;
    border-color: #cbd5e1;
    color: #64748b;
    cursor: not-allowed;
}

/* ==========================================
   VERIFICATION INTRO
========================================== */

.cricket-verification-screen {
    min-height: 420px;
    padding: 40px;
    background: #ffffff;
    border: 1px solid #e2e8f0;
    border-radius: 16px;
}

.cricket-verification-heading {
    margin: 16px 0 20px;
    font: 600 24px 'Space Grotesk',sans-serif;
    color: #2563eb;
}

.cricket-verification-animated {
    font: 600 clamp(26px,3vw,42px)/1.5 'Space Grotesk',sans-serif;
    letter-spacing: -1.2px;
    color: #111827;
    margin: 20px 0 30px;
}

.cricket-verification-word {
    display: inline-block;
    opacity: 0;
    filter: blur(5px);
    transform: translateY(12px);
    animation: cricketWordIn .5s ease forwards;
}

@keyframes cricketWordIn {
    to {
        opacity: 1;
        filter: blur(0);
        transform: translateY(0);
    }
}

.cricket-verification-controls {
    display: flex;
    gap: 12px;
    flex-wrap: wrap;
    margin-bottom: 20px;
}

.cricket-skip-button {
    border: 1px solid #bfdbfe;
    background: #eff6ff;
    border-radius: 9px;
    padding: 12px 17px;
    color: #2563eb;
    font: 700 12px 'DM Sans',sans-serif;
    cursor: pointer;
}

.cricket-verify-panel {
    padding: 25px;
    border: 1px solid #dbeafe;
    border-radius: 12px;
    background: #f8fbff;
}

.cricket-verify-panel[hidden] {
    display: none !important;
}

.cricket-verify-panel h3 {
    font: 600 22px 'Space Grotesk',sans-serif;
    margin: 0 0 10px;
}

.cricket-verify-panel p {
    color: #64748b;
    font: 13px/1.8 'DM Sans',sans-serif;
}

.cricket-verify-requirements {
    display: flex;
    flex-wrap: wrap;
    gap: 9px;
    margin: 18px 0;
}

.cricket-verify-requirements span {
    padding: 8px 11px;
    color: #1d4ed8;
    background: #dbeafe;
    border-radius: 7px;
    font: 700 11px 'DM Sans',sans-serif;
}

.cricket-attestation {
    display: flex;
    align-items: flex-start;
    gap: 12px;
    padding: 16px;
    margin-bottom: 20px;
    background: #ffffff;
    border: 1px solid #e2e8f0;
    border-radius: 9px;
    cursor: pointer;
    color: #334155;
    font: 13px/1.7 'DM Sans',sans-serif;
}

.cricket-attestation input {
    margin-top: 3px;
    accent-color: #2563eb;
}

/* ==========================================
   SPECIALTIES
========================================== */

.cricket-specialty-buttons {
    display: grid;
    grid-template-columns: repeat(2,minmax(0,1fr));
    gap: 10px;
    margin: 18px 0;
}

.cricket-specialty-button {
    padding: 18px;
    background: #ffffff;
    border: 1px solid #e2e8f0;
    border-radius: 10px;
    color: #334155;
    font: 700 13px 'DM Sans',sans-serif;
    text-align: left;
    cursor: pointer;
}

.cricket-specialty-button:hover,
.cricket-specialty-button.selected {
    background: #eff6ff;
    border-color: #2563eb;
    color: #1d4ed8;
}

.cricket-specialty-card {
    background: #f8fafc;
    border: 1px solid #dbeafe;
    border-radius: 11px;
    padding: 22px;
    margin-bottom: 23px;
}

.cricket-specialty-card h3 {
    font: 600 23px 'Space Grotesk',sans-serif;
    margin: 0 0 12px;
}

.cricket-specialty-simple {
    color: #1e40af;
    font: 600 14px/1.8 'DM Sans',sans-serif;
}

.cricket-specialty-detail {
    color: #64748b;
    font: 13px/1.8 'DM Sans',sans-serif;
}

/* ==========================================
   COMPLETION
========================================== */

.cricket-completion-result {
    text-align: center;
    padding: 20px 15px 30px;
}

.cricket-completion-icon {
    display: grid;
    place-items: center;
    width: 66px;
    height: 66px;
    margin: 0 auto 17px;
    border-radius: 50%;
    background: #eff6ff;
    color: #2563eb;
    font-size: 29px;
}

.cricket-completion-result.pending .cricket-completion-icon {
    background: #fff7ed;
    color: #c2410c;
}

.cricket-completion-result h3 {
    font: 600 24px 'Space Grotesk',sans-serif;
    margin: 0 0 8px;
}

.cricket-completion-result p {
    color: #64748b;
    font: 13px/1.7 'DM Sans',sans-serif;
}

/* ==========================================
   DOCUMENTATION EDITOR
========================================== */

.cricket-doc-container {
    background: #f8fafc;
    border: 1px solid #dbeafe;
    border-radius: 13px;
    padding: 25px;
}

.cricket-doc-container h3 {
    font: 600 22px 'Space Grotesk',sans-serif;
    margin: 12px 0;
}

.cricket-doc-help {
    color: #64748b;
    font: 12px/1.8 'DM Sans',sans-serif;
}

.cricket-doc-editor {
    width: 100%;
    min-height: 155px;
    margin: 15px 0;
    padding: 17px;
    border: 1px solid #cbd5e1;
    border-radius: 10px;
    resize: vertical;
    background: #ffffff;
    color: #111827;
    font: 13px/1.8 'DM Sans',sans-serif;
}

.cricket-doc-editor:focus {
    outline: 2px solid #93c5fd;
    border-color: #2563eb;
}

.cricket-doc-confirmation {
    display: flex;
    align-items: flex-start;
    gap: 11px;
    color: #475569;
    font: 12px/1.8 'DM Sans',sans-serif;
    margin-bottom: 18px;
}

.cricket-doc-confirmation input {
    accent-color: #2563eb;
    margin-top: 4px;
}

.cricket-doc-actions,
.cricket-next-call-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    margin-top: 18px;
}

/* ==========================================
   SHIFT LOG
========================================== */

.cricket-shift-toggle {
    position: fixed;
    right: 24px;
    bottom: 24px;
    z-index: 40;
    padding: 13px 18px;
    border: 1px solid #2563eb;
    border-radius: 11px;
    color: #ffffff;
    background: #2563eb;
    box-shadow: 0 10px 30px rgba(37,99,235,.2);
    font: 700 12px 'DM Sans',sans-serif;
    cursor: pointer;
}

.cricket-shift-panel {
    position: fixed;
    top: 0;
    right: 0;
    z-index: 60;
    width: min(430px,100vw);
    height: 100dvh;
    display: flex;
    flex-direction: column;
    padding: 24px;
    background: #ffffff;
    border-left: 1px solid #e2e8f0;
    box-shadow: -15px 0 50px rgba(15,23,42,.14);
    transform: translateX(110%);
    visibility: hidden;
    transition: transform .3s ease,visibility .3s;
}

.cricket-shift-panel.open {
    visibility: visible;
    transform: translateX(0);
}

.cricket-shift-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
}

.cricket-shift-header h3 {
    margin: 0;
    font: 600 23px 'Space Grotesk',sans-serif;
}

.cricket-shift-close {
    width: 34px;
    height: 34px;
    background: #f1f5f9;
    border: none;
    border-radius: 8px;
    font-size: 22px;
    cursor: pointer;
}

.cricket-shift-description {
    color: #64748b;
    font: 12px/1.8 'DM Sans',sans-serif;
    margin: 17px 0;
}

.cricket-shift-entries {
    flex: 1;
    overflow-y: auto;
    min-height: 0;
}

.cricket-shift-empty {
    color: #94a3b8;
    text-align: center;
    padding: 50px 15px;
    font: 13px 'DM Sans',sans-serif;
}

.cricket-shift-entry {
    padding: 17px;
    margin-bottom: 12px;
    background: #f8fafc;
    border: 1px solid #e2e8f0;
    border-radius: 11px;
}

.cricket-shift-time {
    display: block;
    color: #64748b;
    font-size: 10px;
    margin-bottom: 9px;
}

.cricket-shift-entry strong {
    color: #2563eb;
    font-size: 13px;
}

.cricket-shift-entry p {
    color: #334155;
    font: 12px/1.8 'DM Sans',sans-serif;
    white-space: pre-wrap;
    margin: 10px 0;
}

.cricket-shift-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    padding-top: 17px;
    border-top: 1px solid #e2e8f0;
}

/* ==========================================
   END CALL BUTTON
========================================== */

.cricket-end-call-button {
    background: #eff6ff;
    border: 1px solid #bfdbfe;
    border-radius: 8px;
    color: #1d4ed8;
    padding: 10px 13px;
    font: 700 11px 'DM Sans',sans-serif;
    cursor: pointer;
}

.cricket-end-call-button[hidden] {
    display: none !important;
}

/* ==========================================
   ACCESSIBILITY
========================================== */

.cricket-smart-workflow button:focus-visible,
.cricket-verification-screen button:focus-visible,
.cricket-shift-panel button:focus-visible {
    outline: 2px solid #2563eb;
    outline-offset: 3px;
}

[hidden] {
    display: none !important;
}

/* ==========================================
   RESPONSIVE
========================================== */

@media(max-width:700px) {
    .cricket-smart-header {
        padding: 25px 20px;
    }

    .cricket-smart-body {
        padding: 23px 18px;
    }

    .cricket-smart-title {
        font-size: 25px;
    }

    .cricket-smart-option {
        padding: 15px;
    }

    .cricket-verification-screen {
        padding: 23px 20px;
    }

    .cricket-verification-animated {
        font-size: 27px;
    }

    .cricket-specialty-buttons {
        grid-template-columns: 1fr;
    }

    .cricket-doc-container {
        padding: 18px;
    }

    .cricket-doc-actions button,
    .cricket-next-call-actions button {
        width: 100%;
    }

    .cricket-shift-toggle {
        right: 14px;
        bottom: 14px;
        padding: 11px 14px;
    }

    .cricket-shift-panel {
        padding: 18px;
    }

    .cricket-action-text {
        font-size: 16px;
    }
}

@media(prefers-reduced-motion:reduce) {
    .cricket-smart-workflow,
    .cricket-verification-word {
        animation: none;
    }

    .cricket-verification-word {
        opacity: 1;
        filter: none;
        transform: none;
    }

    .cricket-shift-panel,
    .cricket-smart-option,
    .cricket-outcome-button {
        transition: none;
    }
}

    `;

    document.head.append(style);
}

/* ============================================================
   35. INITIALIZATION
============================================================ */

function initializeCricketInbound() {
    /* Department cards */

    routeCards.forEach(card => {
        card.addEventListener(
            "click",
            () => {
                startDepartment(
                    card.dataset.route,
                    false
                );
            }
        );
    });

    /* Navigation */

    backButton.addEventListener(
        "click",
        goBack
    );

    restartButton.addEventListener(
        "click",
        restartWorkflow
    );

    breadcrumbInbound.addEventListener(
        "click",
        returnToSelection
    );

    /* New interface */

    installSmartStyles();

    createShiftPanel();

    installEndCallButton();

    /* Escape closes shift panel */

    document.addEventListener(
        "keydown",
        event => {
            if (event.key === "Escape") {
                closeShiftPanel();
            }
        }
    );

    console.log(
        "[Cricket] Inbound Workflow Engine v" +
        CRICKET_CONFIG.version +
        " initialized."
    );
}

/* ============================================================
   36. APPLICATION START
============================================================ */

if (document.readyState === "loading") {
    document.addEventListener(
        "DOMContentLoaded",
        initializeCricketInbound,
        { once: true }
    );
} else {
    initializeCricketInbound();
}

/* ============================================================
   END OF CRICKET v1.6
============================================================ */
